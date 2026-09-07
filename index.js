require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');

const play = require('@iamtraction/play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const prefix = '!';

// Create the music player
const player = createAudioPlayer();

client.once('clientReady', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {

    // Ignore bots
    if (message.author.bot) return;

    // Only accept commands starting with !
    if (!message.content.startsWith(prefix)) return;

    const args = message.content
        .slice(prefix.length)
        .trim()
        .split(/ +/);

    const command = args.shift().toLowerCase();


    // =====================
    // !hello
    // =====================

    if (command === 'hello') {
        return message.reply('Hello! 👋');
    }


    // =====================
    // !ping
    // =====================

    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }


    // =====================
    // !join
    // =====================

    if (command === 'join') {

        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply(
                '❌ Join a voice channel first!'
            );
        }

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator
        });

        try {
            await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                20_000
            );

            connection.subscribe(player);

            return message.reply(
                '🎵 Joined the voice channel!'
            );

        } catch (error) {

            connection.destroy();

            console.error(error);

            return message.reply(
                '❌ I could not join the voice channel.'
            );
        }
    }


    // =====================
// !play
// =====================

if (command === 'play') {

    const voiceChannel = message.member.voice.channel;

    if (!voiceChannel) {
        return message.reply('❌ Join a voice channel first!');
    }

    const songName = args.join(' ');

    if (!songName) {
        return message.reply(
            '❌ Please type a song name!\nExample: `!play Shape of You`'
        );
    }

    try {

        // Search YouTube
        const results = await play.search(songName, {
            limit: 1,
            source: { youtube: "video" }
        });

        if (!results || results.length === 0) {
            return message.reply('❌ I could not find that song!');
        }

        const song = results[0];

        // Make sure we got a valid URL
        if (!song.url) {
            console.log(song);
            return message.reply(
                '❌ I found a result, but could not get its YouTube link.'
            );
        }

        // Join the voice channel
        let connection = getVoiceConnection(message.guild.id);

        if (!connection) {

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator
            });

            await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                20_000
            );
        }

        // Get the music stream
        const stream = await play.stream(song.url);

        const resource = createAudioResource(
            stream.stream,
            {
                inputType: stream.type
            }
        );

        // Connect and play
        connection.subscribe(player);
        player.play(resource);

        return message.reply(
            `🎵 Now playing: **${song.title}**`
        );

    } catch (error) {

        console.error(error);

        return message.reply(
            '❌ Something went wrong while trying to play that song.'
        );
    }
}


    // =====================
    // !stop
    // =====================

    if (command === 'stop') {

        player.stop();

        return message.reply('⏹️ Music stopped!');
    }


    // =====================
    // !leave
    // =====================

    if (command === 'leave') {

        const connection = getVoiceConnection(message.guild.id);

        if (!connection) {
            return message.reply(
                '❌ I am not in a voice channel!'
            );
        }

        player.stop();

        connection.destroy();

        return message.reply(
            '👋 Left the voice channel!'
        );
    }

});


// LOGIN

client.login(process.env.TOKEN);