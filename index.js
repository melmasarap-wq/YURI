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

const { spawn } = require('child_process');

// =====================================================
// SETTINGS
// =====================================================

const prefix = '!';
const ytDlpPath = 'yt-dlp';

// =====================================================
// CHECK TOKEN
// =====================================================

if (!process.env.TOKEN) {
    console.error('❌ TOKEN is missing!');
    console.error('Add TOKEN to Railway Variables.');
    process.exit(1);
}

console.log('🔑 TOKEN found.');
console.log('🎵 Using yt-dlp:', ytDlpPath);

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// =====================================================
// MUSIC PLAYER
// =====================================================

const player = createAudioPlayer();

player.on('error', error => {
    console.error('❌ Audio player error:', error);
});

// =====================================================
// BOT READY
// =====================================================

client.once('clientReady', () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);
    console.log('✅ Bot is ready.');
});

// =====================================================
// YT-DLP SEARCH
// =====================================================

function searchYouTube(query) {

    return new Promise((resolve, reject) => {

        const args = [
            '--dump-single-json',
            '--flat-playlist',
            '--no-warnings',
            '--no-playlist',
            '--skip-download',
            'ytsearch1:' + query
        ];

        console.log('🔎 YouTube search:', query);

        const process = spawn(
            ytDlpPath,
            args,
            {
                windowsHide: true
            }
        );

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', data => {
            stdout += data.toString();
        });

        process.stderr.on('data', data => {
            stderr += data.toString();
        });

        process.on('error', error => {
            console.error('❌ Could not start yt-dlp:', error);
            reject(error);
        });

        process.on('close', code => {

            if (code !== 0) {

                console.error('❌ yt-dlp search failed.');
                console.error(stderr);

                reject(
                    new Error(
                        `yt-dlp exited with code ${code}: ${stderr}`
                    )
                );

                return;
            }

            try {

                const result = JSON.parse(stdout);

                if (
                    !result ||
                    !result.entries ||
                    result.entries.length === 0
                ) {
                    resolve(null);
                    return;
                }

                const song = result.entries[0];

                const videoUrl =
                    song.webpage_url ||
                    song.url ||
                    (
                        song.id
                            ? `https://www.youtube.com/watch?v=${song.id}`
                            : null
                    );

                resolve({
                    title: song.title || 'Unknown Song',
                    url: videoUrl,
                    id: song.id
                });

            } catch (error) {

                console.error(
                    '❌ Could not read yt-dlp result:',
                    error
                );

                console.error('yt-dlp output:', stdout);

                reject(error);
            }
        });
    });
}

// =====================================================
// YT-DLP AUDIO STREAM
// =====================================================

function getAudioStream(url) {

    const args = [
        '-f',
        'bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio',
        '--no-playlist',
        '--no-warnings',
        '-o',
        '-',
        url
    ];

    console.log('🎧 Starting audio stream...');

    const process = spawn(
        ytDlpPath,
        args,
        {
            windowsHide: true
        }
    );

    process.stderr.on('data', data => {

        const output = data.toString().trim();

        if (output) {
            console.log('yt-dlp:', output);
        }
    });

    process.on('error', error => {
        console.error('❌ yt-dlp audio error:', error);
    });

    process.on('close', code => {

        if (code !== 0) {
            console.error(
                `❌ yt-dlp audio process exited with code ${code}`
            );
        } else {
            console.log('✅ Audio stream finished.');
        }
    });

    return process;
}

// =====================================================
// MESSAGES
// =====================================================

client.on('messageCreate', async message => {

    try {

        // Ignore bots
        if (message.author.bot) return;

        // Ignore messages without prefix
        if (!message.content.startsWith(prefix)) return;

        // =================================================
        // PARSE COMMAND
        // =================================================

        const content = message.content
            .slice(prefix.length)
            .trim();

        if (!content) return;

        const args = content.split(/\s+/);

        const command = args
            .shift()
            .toLowerCase();

        console.log(
            `📩 Command: ${message.content} | User: ${message.author.tag}`
        );

        // =================================================
        // !hello
        // =================================================

        if (command === 'hello') {

            await message.reply('Hello! 👋');

            return;
        }

        // =================================================
        // !ping
        // =================================================

        if (command === 'ping') {

            await message.reply('🏓 Pong!');

            return;
        }

        // =================================================
        // !join
        // =================================================

        if (command === 'join') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {

                await message.reply(
                    '❌ Join a voice channel first!'
                );

                return;
            }

            let connection =
                getVoiceConnection(message.guild.id);

            if (connection) {

                await message.reply(
                    '🎵 I am already in a voice channel!'
                );

                return;
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

                await message.reply(
                    '🎵 Joined the voice channel!'
                );

            } catch (error) {

                console.error(
                    '❌ Voice connection error:',
                    error
                );

                connection.destroy();

                await message.reply(
                    '❌ I could not join the voice channel.'
                );
            }

            return;
        }

        // =================================================
        // !play
        // =================================================

        if (command === 'play') {

            const voiceChannel =
                message.member?.voice?.channel;

            if (!voiceChannel) {

                await message.reply(
                    '❌ Join a voice channel first!'
                );

                return;
            }

            const songName = args.join(' ');

            if (!songName) {

                await message.reply(
                    '❌ Please enter a song name!\n' +
                    'Example: `!play Totoong Tayo`'
                );

                return;
            }

            // ---------------------------------------------
            // SEARCH
            // ---------------------------------------------

            const searchingMessage =
                await message.reply(
                    `🔎 Searching for **${songName}**...`
                );

            let song;

            try {

                song =
                    await searchYouTube(songName);

            } catch (error) {

                console.error(
                    '❌ YouTube search error:',
                    error
                );

                await searchingMessage.edit(
                    '❌ YouTube search failed. Check Railway logs.'
                );

                return;
            }

            if (!song) {

                await searchingMessage.edit(
                    '❌ I could not find that song.'
                );

                return;
            }

            if (!song.url) {

                await searchingMessage.edit(
                    '❌ I found the song but could not get its URL.'
                );

                return;
            }

            console.log('🎵 Song:', song.title);
            console.log('🔗 URL:', song.url);

            // ---------------------------------------------
            // VOICE CONNECTION
            // ---------------------------------------------

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

                    await searchingMessage.edit(
                        '❌ I could not connect to the voice channel.'
                    );

                    return;
                }
            }

            connection.subscribe(player);

            // ---------------------------------------------
            // START AUDIO
            // ---------------------------------------------

            let audioProcess;

            try {

                audioProcess =
                    getAudioStream(song.url);

            } catch (error) {

                console.error(
                    '❌ Could not start audio:',
                    error
                );

                await searchingMessage.edit(
                    '❌ Could not start the music stream.'
                );

                return;
            }

            // ---------------------------------------------
            // CREATE DISCORD AUDIO RESOURCE
            // ---------------------------------------------

            const resource =
                createAudioResource(
                    audioProcess.stdout,
                    {
                        inputType:
                            StreamType.WebmOpus
                    }
                );

            // ---------------------------------------------
            // PLAY
            // ---------------------------------------------

            player.play(resource);

            await searchingMessage.edit(
                `▶️ Now playing: **${song.title}**`
            );

            return;
        }

        // =================================================
        // !stop
        // =================================================

        if (command === 'stop') {

            player.stop();

            await message.reply(
                '⏹️ Music stopped!'
            );

            return;
        }

        // =================================================
        // !leave
        // =================================================

        if (command === 'leave') {

            const connection =
                getVoiceConnection(
                    message.guild.id
                );

            if (!connection) {

                await message.reply(
                    '❌ I am not in a voice channel!'
                );

                return;
            }

            player.stop();

            connection.destroy();

            await message.reply(
                '👋 Left the voice channel!'
            );

            return;
        }

        // =================================================
        // UNKNOWN COMMAND
        // =================================================

        // Optional:
        // Uncomment if you want the bot to respond
        // to unknown commands.

        /*
        await message.reply(
            '❌ Unknown command. Try `!hello`, `!ping`, `!join`, `!play`, `!stop`, or `!leave`.'
        );
        */

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

// =====================================================
// LOGIN
// =====================================================

client.login(process.env.TOKEN)
    .then(() => {

        console.log(
            '🔐 Discord login successful.'
        );

    })
    .catch(error => {

        console.error(
            '❌ Discord login failed:'
        );

        console.error(error);

        process.exit(1);
    });
