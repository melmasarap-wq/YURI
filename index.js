require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const {
joinVoiceChannel,
createAudioPlayer,
createAudioResource,
VoiceConnectionStatus,
entersState,
getVoiceConnection,
StreamType,
AudioPlayerStatus
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
console.error('Add TOKEN to your Railway Variables.');
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

let currentProcess = null;

player.on('error', error => {
console.error('❌ Audio player error:', error.message);
});

player.on(AudioPlayerStatus.Idle, () => {
console.log('⏹️ Player is idle.');

```
if (currentProcess) {
    currentProcess.kill();
    currentProcess = null;
}
```

});

// =====================================================
// BOT READY
// =====================================================

client.once('clientReady', () => {
console.log(`🤖 Logged in as ${client.user.tag}!`);
console.log('✅ Bot is ready.');
});

// =====================================================
// SEARCH YOUTUBE
// =====================================================

function searchYouTube(query) {
return new Promise((resolve, reject) => {

```
    const args = [
        '--dump-single-json',
        '--flat-playlist',
        '--no-warnings',
        '--no-playlist',
        '--skip-download',
        `ytsearch1:${query}`
    ];

    console.log('🔎 Searching YouTube:', query);

    const ytProcess = spawn(ytDlpPath, args, {
        windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    ytProcess.stdout.on('data', data => {
        stdout += data.toString();
    });

    ytProcess.stderr.on('data', data => {
        stderr += data.toString();
    });

    ytProcess.on('error', error => {
        console.error('❌ Could not start yt-dlp:', error.message);
        reject(error);
    });

    ytProcess.on('close', code => {

        if (code !== 0) {
            reject(
                new Error(
                    `yt-dlp search failed (${code}): ${stderr}`
                )
            );
            return;
        }

        try {
            const result = JSON.parse(stdout);

            if (!result.entries || result.entries.length === 0) {
                resolve(null);
                return;
            }

            const song = result.entries[0];

            const url =
                song.webpage_url ||
                (song.id
                    ? `https://www.youtube.com/watch?v=${song.id}`
                    : null);

            resolve({
                title: song.title || 'Unknown Song',
                url
            });

        } catch (error) {
            console.error('❌ JSON error:', error.message);
            console.error('yt-dlp output:', stdout);

            reject(error);
        }
    });
});
```

}

// =====================================================
// GET AUDIO STREAM
// =====================================================

function getAudioStream(url) {

```
const args = [
    '-f',
    'bestaudio[acodec=opus][ext=webm]/bestaudio',
    '--no-playlist',
    '--no-warnings',
    '-o',
    '-',
    url
];

console.log('🎧 Starting audio stream...');

const ytProcess = spawn(
    ytDlpPath,
    args,
    {
        windowsHide: true
    }
);

ytProcess.stderr.on('data', data => {
    const output = data.toString().trim();

    if (output) {
        console.log('yt-dlp:', output);
    }
});

ytProcess.on('error', error => {
    console.error('❌ yt-dlp error:', error.message);
});

ytProcess.on('close', code => {
    console.log(`🎵 yt-dlp process ended with code ${code}`);
});

return ytProcess;
```

}

// =====================================================
// COMMAND HANDLER
// =====================================================

client.on('messageCreate', async message => {

```
try {

    // Ignore bots
    if (message.author.bot) return;

    // Ignore messages without prefix
    if (!message.content.startsWith(prefix)) return;

    // Parse command
    const content = message.content
        .slice(prefix.length)
        .trim();

    if (!content) return;

    const args = content.split(/\s+/);

    const command = args.shift().toLowerCase();

    console.log(
        `📩 ${message.author.tag}: ${message.content}`
    );

    // =================================================
    // !HELLO
    // =================================================

    if (command === 'hello') {
        await message.reply('Hello! 👋');
        return;
    }

    // =================================================
    // !PING
    // =================================================

    if (command === 'ping') {
        await message.reply('🏓 Pong!');
        return;
    }

    // =================================================
    // !JOIN
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

                connection.subscribe(player);

                await message.reply(
                    '🎵 Joined the voice channel!'
                );

            } catch (error) {

                console.error(
                    '❌ Connection error:',
                    error
                );

                connection.destroy();

                await message.reply(
                    '❌ Could not join the voice channel.'
                );
            }

        } else {
            await message.reply(
                '🎵 I am already in a voice channel!'
            );
        }

        return;
    }

    // =================================================
    // !PLAY
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

        const searchingMessage =
            await message.reply(
                `🔎 Searching for **${songName}**...`
            );

        // Stop current music
        player.stop();

        if (currentProcess) {
            currentProcess.kill();
            currentProcess = null;
        }

        // Search song
        let song;

        try {

            song = await searchYouTube(songName);

        } catch (error) {

            console.error(
                '❌ Search error:',
                error
            );

            await searchingMessage.edit(
                '❌ YouTube search failed. Check Railway logs.'
            );

            return;
        }

        if (!song || !song.url) {

            await searchingMessage.edit(
                '❌ I could not find that song.'
            );

            return;
        }

        console.log('🎵 Found:', song.title);
        console.log('🔗 URL:', song.url);

        // =================================================
        // CONNECT TO VOICE
        // =================================================

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
                    '❌ Could not join the voice channel.'
                );

                return;
            }
        }

        connection.subscribe(player);

        // =================================================
        // START AUDIO
        // =================================================

        currentProcess =
            getAudioStream(song.url);

        const resource = createAudioResource(
            currentProcess.stdout,
            {
                inputType: StreamType.WebmOpus
            }
        );

        player.play(resource);

        await searchingMessage.edit(
            `▶️ Now playing: **${song.title}** 🎵`
        );

        return;
    }

    // =================================================
    // !STOP
    // =================================================

    if (command === 'stop') {

        player.stop();

        if (currentProcess) {
            currentProcess.kill();
            currentProcess = null;
        }

        await message.reply(
            '⏹️ Music stopped!'
        );

        return;
    }

    // =================================================
    // !LEAVE
    // =================================================

    if (command === 'leave') {

        const connection =
            getVoiceConnection(message.guild.id);

        if (!connection) {

            await message.reply(
                '❌ I am not in a voice channel!'
            );

            return;
        }

        player.stop();

        if (currentProcess) {
            currentProcess.kill();
            currentProcess = null;
        }

        connection.destroy();

        await message.reply(
            '👋 Left the voice channel!'
        );

        return;
    }

    // =================================================
    // !HELP
    // =================================================

    if (command === 'help') {

        await message.reply(
            '**🎵 YURI Music Bot Commands**\n\n' +
            '`!hello` - Say hello\n' +
            '`!ping` - Check if bot is online\n' +
            '`!join` - Join your voice channel\n' +
            '`!play <song>` - Play music\n' +
            '`!stop` - Stop music\n' +
            '`!leave` - Leave voice channel'
        );

        return;
    }

} catch (error) {

    console.error('❌ Command error:', error);

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
```

});

// =====================================================
// LOGIN
// =====================================================

client.login(process.env.TOKEN)
.then(() => {
console.log('🔐 Discord login successful.');
})
.catch(error => {
console.error('❌ Discord login failed:', error);
process.exit(1);
});
