const config = require('config');
const axios = require('axios');
const url = require('url');
const httpClient = axios.create({
});

const messageKey = 'MESSAGE';
const initialValue = 'Hello World';
const selfCredential = Symbol('self');

const SubComamnds = {
  HELP: 'help',
  LOGOUT: 'logout',
  PROJECT: 'project',
  PROJECTS: 'projects'
}
module.exports = (db, users) => {
  // Basic authorization system. Your app might choose ACLs or some more sophisticated mechanism.
  function isUser (credential) {
    return users.findById(credential.id).then(() => true).catch(() => false);
  }

  function authorizeSelfOrUser (credential) {
    let authorizationPromise;
    if (credential === selfCredential) {
      authorizationPromise = Promise.resolve(true);
    } else {
      authorizationPromise = isUser(credential);
    }
    return authorizationPromise;
  }

  function help () {
    return `
*Available commands*
  _/xnat help_ : Show help message
  _/xnat logout_ : Log out
  _/xnat projects_ : Show project
    `;
  }

  async function logout (credential) {
    const id = credential.id;
    let res = false;
    try {
      await users.delete(id);
      return "Good bye!:smiley:"
    } catch (err) {
      console.log(err)
    }
    return "Failed to log out."
  }

  async function getProjects (credential) {
    const accessToken = credential.accessToken;

    const projetsUrl = config.get('xnat.host');
    projetsUrl.pathname = '/xapi/users/projects';

    try {
      res = await httpClient.get(url.format(projetsUrl), {
        headers: {
          'Authorization': `bearer ${accessToken}`
        }
      });
      let text = '';
      if (res.data.length > 0) {
        text = res.data.join('\n') + '\n';
      }
      text += `*${res.data.length} projects* found.`;
      return text;
    } catch (err) {
      console.log(err);
      return err.message
    }
  }

  return {
    initialize () {
      return this.setMessage(initialValue, selfCredential);
    },

    getMessage (credential = {}) {
      return authorizeSelfOrUser(credential)
        .then((isAuthorized) => {
          if (isAuthorized) {
            return new Promise((resolve, reject) => {
              db.get(messageKey, (error, message) => {
                console.log(error)
                if (error) {
                  if (error.notFound) {
                    resolve(this.initialize());
                  } else {
                    reject(error);
                  }
                } else {
                  resolve(message);
                }
              });
            });
          }
          throw new Error('Not Authorized');
        });
    },

    setMessage (newMessage, credential = {}) {
      return authorizeSelfOrUser(credential)
        .then(isAuthorized => new Promise((resolve, reject) => {
          if (isAuthorized) {
            db.put(messageKey, newMessage, (error) => {
              if (error) {
                reject(error);
              } else {
                resolve(newMessage);
              }
            });
          } else {
            reject(new Error('Not Authorized'));
          }
        }));
    },

    process (text, credential = {}) {
      return authorizeSelfOrUser(credential)
        .then(isAuthorized => new Promise(async (resolve, reject) => {
          if (isAuthorized) {
            const args = text.split(/\s+/)
            const subcommand = args[0] === '' ? SubComamnds.HELP : args[0];

            switch (subcommand) {
              case SubComamnds.HELP:
                resolve(help())
                break;

              case SubComamnds.LOGOUT:
                resolve(await logout(credential))
                break;

              case SubComamnds.PROJECT:
              case SubComamnds.PROJECTS:
                resolve(await getProjects(credential))
                break;

              default:
                reject(new Error('Invalid command'));
            }
          } else {
            reject(new Error('Not Authorized'));
          }
        }));
    }
  };
};
