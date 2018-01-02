import { CLIENT_COMMAND_ERROR } from './types';
import { SERVER_TO_CLIENT } from '../../socket/redux/types';
import parseCommand from '../index';

export function execCommand(action, socket) {
    return (dispatch, getState, io) => {
        const request = parseCommand(socket, action, getState);

        request
            .then((toDispatch) => {
                if (!toDispatch) {
                    return;
                }

                toDispatch.map(dispatch)
            })
            .catch(console.log)

        return request;
    }
}

export function clientCommandError(payload) {
    return {
        type: CLIENT_COMMAND_ERROR,
        subtype: SERVER_TO_CLIENT,
        payload
    }
}