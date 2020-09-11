const config = require('config');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const LevelStore = require('level-session-store')(session);
const flash = require('connect-flash');
const csurf = require('csurf');
const paramCase = require('param-case');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

const ClientOAuth2 = require('client-oauth2');
const url = require('url');

const { WebClient } = require('@slack/web-api');
const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);

const skeletonAuth = {
  clientId: config.get('oauth.clientId'),
  clientSecret: config.get('oauth.clientSecret'),
  accessTokenUri: config.get('oauth.accessTokenUri'),
  authorizationUri: config.get('oauth.authorizationUri'),
  redirectUri: url.format(config.get('server')) + config.get('oauth.redirectUri'),
  scopes: config.get('oauth.scopes')
};

module.exports = (db, users, message) => {
  passport.use(new LocalStrategy((username, password, done) => {
    users.findByUsername(username)
      .then(user => users.checkPassword(user.id, password)
        .then((isCorrect) => {
          if (!isCorrect) {
            done(null, false, { message: 'Credentials are invalid.' });
          } else {
            done(null, user);
          }
        }))
      .catch((error) => {
        if (error.code === 'EUSERNOTFOUND') {
          done(null, false, { message: 'Credentials are invalid.' });
        } else {
          done(error);
        }
      });
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    users.findById(id)
      .then(user => done(null, user))
      .catch((error) => {
        if (error.code === 'EUSERNOTFOUND') {
          done(null, false);
        } else {
          done(error);
        }
      });
  });

  const web = express.Router();
  web.use(express.static('public'));
  web.use(session({
    maxAge: config.get('session.maxAge'),
    resave: false,
    store: new LevelStore(db),
    secret: process.env.SESSION_SECRET,
    secure: !!(config.has('session.secure') && config.get('session.secure')),
    saveUninitialized: false,
  }));
  web.use(bodyParser.urlencoded({ extended: false }));
  web.use(csurf());
  web.use(flash());
  web.use(passport.initialize());
  web.use(passport.session());
  web.use((req, res, next) => {
    res.locals.pageName = paramCase(req.path);
    next();
  });

  web.get('/', (req, res) => {
    let myMessage;

    function renderHome () {
      res.render('home', {
        title: 'Home',
        message: myMessage,
        loginError: req.flash('login-error'),
        csrfToken: req.csrfToken(),
      });
    }

    message.getMessage(req.user)
      .then((m) => {
        myMessage = m;
        renderHome();
      })
      .catch(() => renderHome());
  });

  web.post('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
  });

  web.get(config.get('routes.associationPath'), async (req, res) => {
    const associationRef = req.query.ref
    if (!associationRef) {
      res.send('Invalid access');
      return;
    }
    const association = await users.findSlackAssociation(associationRef)
    if (association.used) {
      res.send('Sorry, this link is expired.');
      return;
    }

    const oauthClientAuth = new ClientOAuth2(
      Object.assign(skeletonAuth, { state: associationRef })
    );

    const uri = oauthClientAuth.code.getUri();
    res.redirect(uri);

    // if (!req.user) {
    // } else {
    //   if (req.user.slack) {
    //     res.render('association', {
    //       mainMessage: 'Your user account is already associated with a Slack user.',
    //     });
    //   } else if (req.query.ref) {
    //     users.completeSlackAssociation(req.user.id, req.query.ref)
    //       .then(() => {
    //         res.render('association', {
    //           mainMessage: 'Your user account has successfully been associated with your Slack user.',
    //           redirectUrl: '/',
    //         });
    //       })
    //       .catch((error) => {
    //         res.render('association', {
    //           mainMessage: `An error occurred: ${error.message}`,
    //         });
    //       });
    //   } else {
    //     // You might want to supply an alternative user association flow with Sign In With Slack
    //     res.render('association', {
    //       mainMessage: 'You must begin the user association process before visiting this page.',
    //     });
    //   }
    // }
  });

  web.get(config.get('oauth.redirectUri'), (req, res) => {
    const oauthClientAuth = new ClientOAuth2(
      skeletonAuth
    );
    const associationRef = req.query.state

    oauthClientAuth.code.getToken(req.originalUrl)
      .then(function (user) {
        users.findSlackAssociation(associationRef)
          .then(association => {
            users.register({
              slackUserId: association.slackUserId,
              accessToken: user.accessToken,
            })
            return association;
          })
          .then((association) => {
            webClient.conversations.open({ users: association.slackUserId })
              .then((r) => {
                const dmChannelId = r.channel.id;

                const slackMessage = webClient.chat.postMessage({
                  channel: dmChannelId,
                  attachments: [
                    {
                      text: `Congratulation! :tada::tada: You can use xnat command now!`,
                    },
                  ],
                }
                );

                const complete = users.completeSlackAssociation(associationRef)
                return Promise.all([slackMessage, complete]);
              })
          })
        return res.send("Congratulation! You successfully logged into XNAT. You can close this tab.")
      })
  });

  return web;
};
