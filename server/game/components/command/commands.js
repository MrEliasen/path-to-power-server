import {CHAT_MESSAGE} from './types';

function checkChatCooldown(character, Game, callback) {
    // check if the character has an existing cooldown for this action, if they are trying to hide
    const ticksLeft = Game.cooldownManager.ticksLeft(character, 'chat');

    if (ticksLeft) {
        return Game.eventToUser(character.user_id, 'error', `You must wait another ${(ticksLeft / 10)} seconds before you can send another message.`);
    }

    // add the search cooldown to the character
    Game.cooldownManager.add(character, 'chat', null, true);

    // return the new cooldown
    callback();
}

function cmdGlobal(socket, command, params, cmdObject, Game) {
    const message = params.join(' ').trim();

    // check if the message is empty
    if (!message.length) {
        return Game.eventToSocket(socket, 'error', 'You must specify a message to send. Syntax: /g <message>');
    }

    Game.characterManager.get(socket.user.user_id)
        .then((character) => {
            // check for cooldowns
            checkChatCooldown(character, Game, () => {
                Game.socketManager.dispatchToServer({
                    type: CHAT_MESSAGE,
                    payload: {
                        user_id: character.user_id,
                        name: character.name,
                        message: params.join(' '),
                        type: 'global',
                    },
                });
            });
        })
        .catch(() => {});
}

function cmdSay(socket, command, params, cmdObject, Game) {
    const message = params.join(' ').trim();

    // check if the message is empty
    if (!message.length) {
        return Game.eventToSocket(socket, 'error', 'You must specify a message to send. Syntax: /s <message>');
    }

    Game.characterManager.get(socket.user.user_id)
        .then((character) => {
            // check for cooldowns
            checkChatCooldown(character, Game, () => {
                Game.socketManager.dispatchToRoom(`${character.location.map}_${character.location.y}_${character.location.x}`, {
                    type: CHAT_MESSAGE,
                    payload: {
                        user_id: character.user_id,
                        name: character.name,
                        message: message,
                        type: 'local',
                    },
                });
            });
        })
        .catch(() => {});
}

function cmdWhisper(socket, player, command, params, cmdObject, Game) {
    // check for cooldowns
    checkChatCooldown(player, Game, () => {
        const whisperTarget = params[0];
        const message = params[1];

        // send message to the socket
        Game.socketManager.dispatchToSocket(socket, {
            type: CHAT_MESSAGE,
            payload: {
                type: 'whisper-out',
                user_id: whisperTarget.user_id,
                name: whisperTarget.name,
                message: message,
            },
        });
        // send message to the target user
        Game.socketManager.dispatchToUser(whisperTarget.user_id, {
            type: CHAT_MESSAGE,
            payload: {
                type: 'whisper-in',
                user_id: player.user_id,
                name: player.name,
                message: message,
            },
        });
    });
}

module.exports = [
    {
        command: '/global',
        aliases: [
            '/g',
            '/yell',
        ],
        params: [
            {
                name: 'Message',
                desc: 'The message you wish to send to the player.',
                rules: 'required|minlen:1|maxlen:500',
            },
        ],
        description: 'Speak in global chat.',
        method: cmdGlobal,
    },
    {
        command: '/say',
        aliases: [
            '/s',
        ],
        params: [
            {
                name: 'Message',
                desc: 'The message you wish to send to the player.',
                rules: 'required|minlen:1|maxlen:500',
            },
        ],
        description: 'Speak in local chat. Only people in same spot can see it.',
        method: cmdSay,
    },
    {
        command: '/whisper',
        aliases: [
            '/w',
            '/tell',
            '/pm',
        ],
        params: [
            {
                name: 'Target',
                desc: 'The name of the player you want to send a private message to',
                rules: 'required|player',
            },
            {
                name: 'Message',
                desc: 'The message you wish to send to the player.',
                rules: 'required|minlen:1|maxlen:500',
            },
        ],
        description: 'Send a private message to another player.',
        method: cmdWhisper,
    },
];
