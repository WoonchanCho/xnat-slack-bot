const url = require('url');
const config = require('config');
const uuid = require('uuid');
const randomstring = require('randomstring');
// const bcrypt = require('bcrypt');
const SlackWebClient = require('@slack/client').WebClient;

// The shape of a user object:
// {
//   id: '',
//   username: '',
//   passwordHash: '',
//   slack: {
//     id: '',
//     dmChannelId: '',
//   },
// }

const slack = new SlackWebClient(process.env.SLACK_BOT_TOKEN);

const { WebClient } = require('@slack/web-api');
const web = new WebClient(process.env.SLACK_BOT_TOKEN);

function dataStoreOperation (store, op, ...params) {
  return new Promise((resolve, reject) => {
    params.push({ valueEncoding: 'json' });
    params.push((error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });
    store[op](...params);
  });
}

module.exports = (db) => {
  const userStore = db.sublevel('userlist');
  const linkStore = db.sublevel('associationlinklist');

  function searchUsers (predicate) {
    return new Promise((resolve, reject) => {
      let foundItem;
      userStore.createValueStream({ valueEncoding: 'json' })
        .on('data', function onData (item) {
          if (!foundItem && predicate(item)) {
            foundItem = item;
            this.destroy();
            resolve(foundItem);
          }
        })
        .on('close', () => {
          if (!foundItem) {
            const notFoundError = new Error('User not found');
            notFoundError.code = 'EUSERNOTFOUND';
            reject(notFoundError);
          }
        })
        .on('error', reject);
    });
  }

  return {
    findById (id) {
      return dataStoreOperation(userStore, 'get', id)
        .catch((error) => {
          if (error.notFound) {
            const notFoundError = new Error('User not found');
            notFoundError.code = 'EUSERNOTFOUND';
            throw notFoundError;
          }
          throw error;
        });
    },

    setById (id, user) {
      return dataStoreOperation(userStore, 'put', id, user).then(() => user);
    },

    findByUsername (username) {
      return searchUsers(user => user.username === username);
    },

    findBySlackId (slackId) {
      return searchUsers(user => user.slackUserId === slackId);
    },

    checkPassword (userId, password) {
      return this.findById(userId)
        .then(user => new Promise((resolve, reject) => {
          if (password == user.passwordHash) {
            reject('password error');
          } else {
            resolve();
          }
          // bcrypt.compare(password, user.passwordHash, (hashError, res) => {
          //   if (hashError) {
          //     reject(hashError);
          //   } else {
          //     resolve(!!res);
          //   }
          // });
        }));
    },

    delete (id) {
      return dataStoreOperation(userStore, 'del', id)
    },

    register ({ slackUserId, accessToken }) {
      // Validations
      // NOTE: more validations would be necessary for a production app, such as password length
      // and/or complexity
      if (!slackUserId) {
        return Promise.reject(new Error('A slackUserId is required'));
      }
      if (!accessToken) {
        return Promise.reject(new Error('A accessToken is required'));
      }

      return new Promise((resolve, reject) => {
        const user = {
          id: uuid(),
          slackUserId,
          accessToken
        };
        resolve(this.setById(user.id, user));
      });
    },

    beginSlackAssociation (slackUserId) {
      const associationLink = {
        ref: randomstring.generate(),
        slackUserId,
      };

      return web.conversations.open({ users: slackUserId })
        .then((r) => {
          associationLink.dmChannelId = r.channel.id;
          const authUrl = config.get('server');
          authUrl.pathname = config.get('routes.associationPath');
          authUrl.query = { ref: associationLink.ref };

          const slackMessage = web.chat.postEphemeral({
            channel: associationLink.dmChannelId,
            user: slackUserId,
            text: `Please log in to ${config.get('app.name')}.`,
            attachments: [
              {
                text: `<${url.format(authUrl)}|Click here> to introduce yourself to me by authenticating.`,
              },
            ],
          }
          );
          const saveLink = dataStoreOperation(linkStore, 'put', associationLink.ref, associationLink);
          return Promise.all([slackMessage, saveLink]);
        })
        .then(() => {
          return associationLink.ref
        });
    },

    findSlackAssociation (associationRef) {
      return dataStoreOperation(linkStore, 'get', associationRef)
        .catch((error) => {
          if (error.notFound) {
            throw new Error('The user association link was not valid.');
          } else {
            throw error;
          }
        })
    },

    completeSlackAssociation (associationRef) {
      return dataStoreOperation(linkStore, 'get', associationRef)
        .catch((error) => {
          if (error.notFound) {
            throw new Error('The user association link was not valid.');
          } else {
            throw error;
          }
        })
        .then((associationLink) => {
          associationLink.used = true;
          dataStoreOperation(linkStore, 'put', associationLink.ref, associationLink)
        });
    },
  };
};
