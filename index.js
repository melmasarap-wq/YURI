// =====================================================
// PLAY
//
// Supports:
// !play song name
// !play https://www.youtube.com/watch?v=xxxxx
// !play https://youtu.be/xxxxx
// =====================================================

if (
    lowerCommand === "play"
) {

    const query =
        args.join(" ").trim();


    if (!query) {

        await message.reply(
            "Usage: !play <song name or YouTube link>"
        );

        return;

    }


    const voiceChannel =
        message.member &&
        message.member.voice &&
        message.member.voice.channel;


    if (!voiceChannel) {

        await message.reply(
            "You need to join a voice channel first."
        );

        return;

    }


    music.playbackId++;


    const thisPlayback =
        music.playbackId;


    console.log(
        "New playback request #" +
        thisPlayback +
        " in guild " +
        guildId +
        ": " +
        query
    );


    stopCurrentAudio(
        guildId
    );


    let searchingMessage =
        null;


    try {

        // =================================================
        // INITIAL MESSAGE
        // =================================================

        searchingMessage =
            await message.reply(
                "Processing " +
                query +
                "..."
            );


        // =================================================
        // DETECT IF INPUT IS A URL
        // =================================================

        const isUrl =
            /^https?:\/\/\S+$/i.test(query);


        let video = null;


        // =================================================
        // DIRECT URL
        // =================================================

        if (isUrl) {

            console.log(
                "Direct URL detected:"
            );

            console.log(
                query
            );


            await searchingMessage.edit(
                "Getting video information..."
            );


            try {

                const infoArgs =
                    getYtDlpCommonArgs();


                infoArgs.push(
                    "--dump-single-json",
                    "--skip-download"
                );


                if (getYouTubeCookies()) {

                    infoArgs.push(
                        "--cookies",
                        cookiesPath
                    );

                }


                infoArgs.push(
                    query
                );


                const infoOutput =
                    await ytDlp.execPromise(
                        infoArgs
                    );


                const info =
                    JSON.parse(
                        String(infoOutput)
                    );


                if (
                    !info
                ) {

                    throw new Error(
                        "Could not read video information."
                    );

                }


                // -------------------------------------------------
                // Reject playlists
                // -------------------------------------------------

                if (
                    info._type === "playlist" ||
                    info.entries
                ) {

                    throw new Error(
                        "Playlist links are not supported. Please paste a single video link."
                    );

                }


                video = {

                    id:
                        info.id ||
                        null,

                    title:
                        info.title ||
                        "YouTube video",

                    url:
                        query

                };


                console.log(
                    "Direct link title: " +
                    video.title
                );

            } catch (error) {

                console.error(
                    "Direct URL information error:",
                    error.message
                );


                await searchingMessage.edit(
                    "I couldn't read that YouTube link.\n\n" +
                    "Reason: " +
                    error.message
                );


                return;

            }

        }


        // =================================================
        // SEARCH BY SONG NAME
        // =================================================

        else {

            await searchingMessage.edit(
                "Searching for " +
                query +
                "..."
            );


            video =
                await searchYouTube(
                    query
                );


            if (!video) {

                await searchingMessage.edit(
                    "I couldn't find that song."
                );

                return;

            }

        }


        // =================================================
        // PLAYBACK CHECK
        // =================================================

        if (
            thisPlayback !==
            music.playbackId
        ) {

            return;

        }


        if (!video) {

            await searchingMessage.edit(
                "I couldn't find anything to play."
            );

            return;

        }


        console.log(
            "Selected video: " +
            video.title
        );


        console.log(
            "URL: " +
            video.url
        );


        // =================================================
        // VOICE CONNECTION
        // =================================================

        if (
            !music.connection ||
            music.connection.state.status !==
            VoiceConnectionStatus.Ready
        ) {

            try {

                music.connection =
                    joinVoiceChannel({

                        channelId:
                            voiceChannel.id,

                        guildId:
                            voiceChannel.guild.id,

                        adapterCreator:
                            voiceChannel.guild
                                .voiceAdapterCreator,

                        selfDeaf:
                            true

                    });


                await entersState(
                    music.connection,
                    VoiceConnectionStatus.Ready,
                    30000
                );


                music.connection.subscribe(
                    music.player
                );

            } catch (error) {

                if (
                    thisPlayback !==
                    music.playbackId
                ) {

                    return;

                }


                console.error(
                    "Voice connection error:",
                    error
                );


                await searchingMessage.edit(
                    "I couldn't connect to the voice channel."
                );


                return;

            }

        }


        // =================================================
        // START AUDIO
        // =================================================

        await searchingMessage.edit(
            "Loading: " +
            video.title
        );


        let audio;


        try {

            audio =
                await getAudioStream(
                    video.url,
                    guildId,
                    thisPlayback
                );

        } catch (error) {

            if (
                thisPlayback !==
                music.playbackId
            ) {

                return;

            }


            console.error(
                "Audio error:",
                error.message
            );


            await searchingMessage.edit(
                "I couldn't play this song.\n\n" +
                "Reason: " +
                error.message
            );


            return;

        }


        // =================================================
        // PLAYBACK CHECK
        // =================================================

        if (
            thisPlayback !==
            music.playbackId
        ) {

            try {

                audio.process.kill();

            } catch (error) {}


            return;

        }


        // =================================================
        // CREATE RAW PCM RESOURCE
        // =================================================

        let resource;


        try {

            resource =
                createAudioResource(
                    audio.stream,
                    {
                        inputType:
                            StreamType.Raw,

                        inlineVolume:
                            false
                    }
                );

        } catch (error) {

            try {

                audio.process.kill();

            } catch (err) {}


            throw error;

        }


        // =================================================
        // FINAL PLAYBACK CHECK
        // =================================================

        if (
            thisPlayback !==
            music.playbackId
        ) {

            try {

                audio.process.kill();

            } catch (error) {}


            return;

        }


        // =================================================
        // PLAY
        // =================================================

        music.player.play(
            resource
        );


        await searchingMessage.edit(
            "Now playing: " +
            video.title
        );


        console.log(
            "Playing playback #" +
            thisPlayback +
            " in guild " +
            guildId +
            ": " +
            video.title
        );

    } catch (error) {

        if (
            thisPlayback !==
            music.playbackId
        ) {

            return;

        }


        console.error(
            "Play command error:",
            error
        );


        try {

            if (
                searchingMessage
            ) {

                await searchingMessage.edit(
                    "Something went wrong while playing the song.\n\n" +
                    "Reason: " +
                    error.message
                );

            } else {

                await message.reply(
                    "Something went wrong while playing the song.\n\n" +
                    "Reason: " +
                    error.message
                );

            }

        } catch (sendError) {

            console.error(
                "Could not send error message:",
                sendError
            );

        }

    }


    return;

}
