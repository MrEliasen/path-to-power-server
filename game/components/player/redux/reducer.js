import { ACCOUNT_AUTHENTICATE } from '../../account/redux/types';

export default function (state = {}, action) {
    switch (action.type) {
        case ACCOUNT_AUTHENTICATE:
            console.log('ACCOUNT_AUTHENTICATE:', action.payload);
            return state;
    }

    return state;
}