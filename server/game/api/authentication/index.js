import passport from 'passport';
import config from '../../../config.json';
import UserModel from '../models/user';
import IdentityModel from '../models/identity';
import jwt from 'jsonwebtoken';

// authentication strategies
import {signup, setup as localSetup} from './strategies/local';
import {setup as oauthSetup} from './strategies/oauth';

/**
 * Loads the authentication strategies
 * @param  {Express} app
 */
export function loadStrategies(passport, logger) {
    const providers = config.api.authentication.providers;

    for (let provider in providers) {
        if (providers.hasOwnProperty(provider)) {
            if (!providers[provider].enabled) {
                continue;
            }

            let callbackUrl = `${config.api.domain}${[80, 443].includes(config.api.post) ? '' : `:${config.api.port}`}/api/auth/${providers[provider].id}/callback`;

            // if its the local auth provider, we have to use a separate strategy from OAuth.
            if (provider === 'local') {
                localSetup(passport, logger);
                continue;
            }

            try {
                oauthSetup(
                    passport,
                    {
                        ...providers[provider],
                        callbackUrl,
                    },
                    logger
                );
            } catch (err) {
                logger.error(err);
            }
        }
    };
}

export const createUser = signup;

/**
 * Handles updates to a user
 * @param  {Express Request} req
 * @param  {Express Response} res
 */
export function updateUser(req, res) {

}

/**
 * Handles user deletions
 * @param  {Express Request} req
 * @param  {Express Response} res
 */
export function deleteUser(req, res) {

}

/**
 * Handles user fetch
 * @param  {Express Request} req
 * @param  {Express Response} res
 */
export async function getUser(req, res) {
    try {
        const identities = await IdentityModel.findAsync(
            {userId: req.user._id},
            {_id: 0, provider: 1, date_added: 1}
        );

        res.json({
            status: 200,
            user: {
                ...req.user,
                identities,
            },
        });
    } catch (err) {
        logger.error(err);

        return res.status(500).json({
            status: 500,
            error: 'Something went wrong. Please try again in a moment.',
        });
    }
}

/**
 * Handles user activation requests
 * @param  {Express Request}  req
 * @param  {Express Response} res
 */
export function activateUser(req, res) {
    if (!req.query.token || !req.query.token.length) {
        return res.status(400).json({
            status: 400,
            error: 'Missing activation token.',
        });
    }

    if (req.query.token.length !== 64) {
        return res.status(400).json({
            status: 400,
            error: 'Invalid activation token.',
        });
    }

    UserModel.findOne({_id: escape(req.params.userId), activationToken: escape(req.query.token)}, (err, user) => {
        if (err) {
            return res.status(500).json({
                status: 500,
                error: 'Something went wrong. Please try again in a moment.',
            });
        }

        if (!user) {
            return res.status(400).json({
                status: 400,
                error: 'Invalid activation token.2',
            });
        }

        // activate the user and remove the token
        user.activationToken = '';
        user.activated = true;

        user.save((err) => {
            if (err) {
                return res.status(500).json({
                    status: 500,
                    error: 'Sometihng went wrong. Please try again in a moment.',
                });
            }

            return res.status(200).json({
                status: 200,
                message: 'Your account has been activated!',
            });
        });
    });
}

/**
 * Handles authentication requests
 * @param  {Express Request} req
 * @param  {Express Response} res
 * @return {Function}
 */
export function authenticate(req, res, next) {
    const method = req.body.method || req.params.provider;

    if (!method) {
        return res.status(400).json({
            status: 400,
            error: 'Invalid authentication method.',
        });
    }

    return passport.authenticate(method, {session: false}, (err, success, info, status) => {
        if (success) {
            return onAuth(req, res, success, method !== 'local');
        }


        res.status(status || 400).json({
            status: status || 400,
            error: err || info.message,
        });
    })(req, res, next);
}

/**
 * Handles successful authentication requests
 * @param  {Express Request} req
 * @param  {Express Reponse} res
 */
export function onAuth(req, res, data, redirect) {
    const token = jwt.sign({
        _id: data._id,
        session_token: data.session_token,
    }, req.app.get('config').api.signingKey, {expiresIn: '7d'});

    if (redirect) {
        return res.redirect(`${req.app.get('config').clientUrl}/auth?token=${token}`);
    }

    // send JWT back to client
    res.json({
        status: 200,
        authToken: token,
    });
}

/**
 * Loads the authentication strategies
 * @param  {Express} app
 */
export function getAuthList(req, res) {
    const providers = config.api.authentication.providers;
    const authlist = [];

    for (let provider in providers) {
        if (providers.hasOwnProperty(provider)) {
            if (!providers[provider].enabled) {
                continue;
            }

            authlist.push({
                provider,
                name: providers[provider].name,
                authUrl: `${config.api.domain}${[80, 443].includes(config.api.post) ? '' : `:${config.api.port}`}/api/auth/${providers[provider].id}`,
            });
        }
    };

    res.json({
        status: 200,
        authlist,
    });
}

/**
 * Verifies a request has a legit auth token
 * @param  {Express Request}   req
 * @param  {Express Response}  res
 * @param  {Function}          next
 */
export function isAuthenticated(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(401).json({
            status: 401,
            message: 'Invalid authorisation token.',
        });
    }

    jwt.verify(token.replace('Bearer ', ''), req.app.get('config').api.signingKey, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                status: 401,
                message: 'Invalid authorisation token.',
            });
        }

        // check the token is for the user we are altering.
        if (!req.params.userId || req.params.userId !== decoded._id) {
            return res.status(401).json({
                status: 401,
                message: 'Invalid authorisation token.',
            });
        }

        UserModel.findOne(
            {_id: decoded._id, session_token: decoded.session_token},
            {_id: 1, session_token: 1, activated: 1, date_added: 1, password: 1},
            (err, user) => {
                if (err || !user) {
                    return res.status(401).json({
                        status: 401,
                        message: 'Invalid authorisation token.',
                    });
                }

                // check if the user has set a password (have local auth enabled)
                user.password = user.password ? true : false;

                req.user = user.toObject();
                next();
            }
        );
    });
}
