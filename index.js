require('dotenv').config();

const {
    Client,
    GatewayIntentBits
} = require('discord.js');

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection,
    StreamType
} = require('@discordjs/voice');

const YTDlpWrap = require('yt-dlp-wrap').default;

// =============================
// CHECK TOKEN
// =============================

if (!process.env.TOKEN) {
    console.error('❌ TOKEN is missing!');
    console.error('Add TOKEN to Railway Variables.');
    process.exit(1);
}

// =============================
// YT-DLP
// =============================

const ytDlp = new YTDlpWrap();

// =============================
// DISCORD CLIENT
// =============================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const prefix = '!';

// =============================
// MUSIC PLAYER
// =============================

const player = createAudioPlayer();

// =============================
// BOT READY
// =============================

client.once('clientReady', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
});

// =============================
// PLAYER ERROR
// =============================

player.on('error', error => {
    console.error('❌ Audio player error:', error);
});

// =============================
// MESSAGES
// =============================

client.on('messageCreate', async message => {

    try {

        // Ignore bots
        if (message.author.bot) return;

        // Ignore messages without prefix
        if (!message.content.startsWith(prefix)) return;

        const args = message.content
            .slice(prefix.length)
            .trim()
            .split(/\s+/);

        const command = args.shift()?.toLowerCase();

        // =============================
        // !hello
        // =============================

        if (command === 'hello') {
            return message.reply('Hello! 👋');
        }

        // =============================
        // !ping
        // =============================

        if (command === 'ping') {
            return message.reply('🏓 Pong!');
        }

        // =============================
        // !join
        // =============================

        if (command === 'join') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {
                return message.reply(
                    '❌ Join a voice channel first!'
                );
            }

            let connection =
                getVoiceConnection(message.guild.id);

            if (connection) {
                return message.reply(
                    '🎵 I am already in a voice channel!'
                );
            }

            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator:
                    message.guild.voiceAdapterCreator
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

                console.error(
                    '❌ Voice connection error:',
                    error
                );

                connection.destroy();

                return message.reply(
                    '❌ I could not join the voice channel.'
                );
            }
        }

        // =============================
        // !play
        // =============================

        if (command === 'play') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {
                return message.reply(
                    '❌ Join a voice channel first!'
                );
            }

            const songName = args.join(' ');

            if (!songName) {
                return message.reply(
                    '❌ Please type a song name!\n' +
                    'Example: `!play Shape of You`'
                );
            }

            await message.channel.send(
                `🔎 Searching for **${songName}**...`
            );

            // =============================
            // SEARCH YOUTUBE
            // =============================

            let searchOutput;

            try {

                searchOutput = await ytDlp.execPromise([
                    `ytsearch1:${songName}`,
                    '--dump-single-json',
                    '--no-warnings',
                    '--no-playlist',
                    '--skip-download'
                ]);

            } catch (error) {

                console.error(
                    '❌ YouTube search error:',
                    error
                );

                return message.reply(
                    '❌ I could not search YouTube.'
                );
            }

            let searchResult;

            try {

                searchResult = JSON.parse(
                    searchOutput
                );

            } catch (error) {

                console.error(
                    '❌ Could not parse YouTube result:',
                    error
                );

                return message.reply(
                    '❌ YouTube returned an invalid result.'
                );
            }

            if (
                !searchResult ||
                !searchResult.entries ||
                searchResult.entries.length === 0
            ) {
                return message.reply(
                    '❌ I could not find that song!'
                );
            }

            const song =
                searchResult.entries[0];

            if (!song.webpage_url) {
                return message.reply(
                    '❌ I could not get the YouTube URL.'
                );
            }

            // =============================
            // VOICE CONNECTION
            // =============================

            let connection =
                getVoiceConnection(message.guild.id);

            if (!connection) {

                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator:
                        message.guild.voiceAdapterCreator
                });

                try {

                    await entersState(
                        connection,
                        VoiceConnectionStatus.Ready,
                        20_000
                    );

                } catch (error) {

                    console.error(
                        '❌ Voice connection error:',
                        error
                    );

                    connection.destroy();

                    return message.reply(
                        '❌ I could not connect to the voice channel.'
                    );
                }
            }

            connection.subscribe(player);

            // =============================
            // GET AUDIO STREAM
            // =============================

            let audioProcess;

            try {

                audioProcess = ytDlp.exec(
                    song.webpage_url,
                    [
                        '-f',
                        'bestaudio[acodec=opus][ext=webm]/bestaudio',
                        '-o',
                        '-',
                        '--no-playlist',
                        '--quiet',
                        '--no-warnings'
                    ]
                );

            } catch (error) {

                console.error(
                    '❌ Could not start yt-dlp:',
                    error
                );

                return message.reply(
                    '❌ I could not start the music stream.'
                );
            }

            audioProcess.stderr.on(
                'data',
                data => {

                    const output =
                        data.toString().trim();

                    if (output) {
                        console.log(
                            'yt-dlp:',
                            output
                        );
                    }
                }
            );

            audioProcess.on(
                'error',
                error => {

                    console.error(
                        '❌ yt-dlp audio error:',
                        error
                    );
                }
            );

            // =============================
            // CREATE AUDIO RESOURCE
            // =============================

            const resource =
                createAudioResource(
                    audioProcess.stdout,
                    {
                        inputType:
                            StreamType.WebmOpus
                    }
                );

            // =============================
            // PLAY
            // =============================

            player.play(resource);

            return message.reply(
                `▶️ Now playing: **${song.title}**`
            );
        }

        // =============================
        // !stop
        // =============================

        if (command === 'stop') {

            player.stop();

            return message.reply(
                '⏹️ Music stopped!'
            );
        }

        // =============================
        // !leave
        // =============================

        if (command === 'leave') {

            const connection =
                getVoiceConnection(
                    message.guild.id
                );

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

    } catch (error) {

        console.error(
            '❌ Command error:',
            error
        );

        try {

            await message.reply(
                '❌ Something went wrong. Check the Railway logs.'
            );

        } catch (replyError) {

            console.error(
                '❌ Could not send error message:',
                replyError
            );
        }
    }
});

// =============================
// LOGIN
// =============================

client.login(process.env.TOKEN)
    .then(() => {

        console.log(
            '🔐 Login successful.'
        );

    })
    .catch(error => {

        console.error(
            '❌ Discord login failed:'
        );

        console.error(error);

        process.exit(1);
    });
