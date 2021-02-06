import dotenv from 'dotenv'; dotenv.config();   // Load Enviroment
import { BaseAPI } from './Gall/BaseAPI.mjs';
import Discord from 'discord.js';               // The discord client
import { Gallery } from './Gall/Types.mjs';

const gall          = new BaseAPI(`${process.env.GALL_URL}api`, process.env.GALL_TOKEN);
const discord       = new Discord.Client();
const galleryCache  = new Map();

/** When the bot is first ready, lets try and publish all the guilds we are in */
discord.on('ready', async () => {
    console.log('bot is ready 🤖');
    for(let k of discord.guilds.cache) {
        const emojis = k[1].emojis.cache.array();
        const result = await gall.updateGuild(k[0], k[1].name, emojis);
        if (result == null) { gall.addGuild(k[0]); }
    }
});

/** When we have a message, look for links on the message */
discord.on('message', async (msg) => {
    if (msg.author.bot) return;

    //See if it is a gallery post
    let gallery = await findGalleryFromMessageContent(msg.content);
    if (gallery != null) {
        msg.react('🔥');
        return;
    }

    //TODO: Convert the multiple urls into one gallery

    //Find any URL in the sent message
    const regexp = /(https?:\/\/)?([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b)([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)?/ig;
    let matches;
    while((matches = regexp.exec(str)) !== null) {
        const matches = msg.content.match(findSimilarURL);
        if (matches == null) return;
        
        //Processing indicator
        const reaction = await msg.react('🕑');

        //Submit the message and cache the ids so we dont look it up again
        // We rebuild the URL because we want them to paste without the http
        const url       = (matches[1] ?? 'https://') + matches[2] + matches[3];
        const gallmsg   = null; //await msg.channel.send(proxyImage(url));

        //Publish the image and set the results in the cache so in the future we can look it up faster
        try {
            gallery = await gall.actAs(msg.author.id).publish(url, msg.guild.id, msg.channel.id, msg.id);

            galleryCache.set(msg.id, gallery ? gallery.id : null);
            if (gallmsg != null)
                galleryCache.set(gallmsg.id, gallery ? gallery.id : null);

            //Supress the embed for admins
            msg.suppressEmbeds(true);

            //Send teh resulting message with the post
            if (gallery) await sendGalleryMessage(msg.channel, gallery, gallmsg);
        }catch(error) {
            await msg.react('❌');
            console.error(error);
        } finally {
            await reaction.remove();
        }
    }
    
});

/** React to the gall images */
discord.on('raw', async (packet) => {
    if (packet.t === 'MESSAGE_REACTION_ADD' || packet.t === 'MESSAGE_REACTION_REMOVE') {
        
        /** If its not a reaction add, then its a remove :3 */
        const isReactionAdd = packet.t === 'MESSAGE_REACTION_ADD';

        //Validate we are not a bot
        const reactionEvent = packet.d;
        if (reactionEvent.member && reactionEvent.member.user && reactionEvent.member.user.bot) return;
        
        //Set who we are acting as and check the galleries
        gall.actAs(reactionEvent.user_id);
        let gallery = await findGalleryFromMessageIds(reactionEvent.message_id, reactionEvent.channel_id);
        if (gallery == null) return;
        
        //If its a fire, then we will do seperate things
        if (reactionEvent.emoji.name === '🔥' || reactionEvent.emoji.name === '🔖' || reactionEvent.emoji.name === '👀') {
            //Favourite the gallery
            if (isReactionAdd)  await gall.favourite(gallery);
            else                await gall.unfavourite(gallery);
        } else if (reactionEvent.emoji.name === '📌' || reactionEvent.emoji.name === '📍') { 
            //Set the pin state of the gallery
            if (isReactionAdd)  await gall.pin(gallery);
        } else {
            //Set the reaction of the gallery
            if (isReactionAdd)  await gall.addReaction(gallery, reactionEvent.emoji);
            else                await gall.removeReaction(gallery, reactionEvent.emoji);
        }
    }
});

/** When we join or leave a guild, we should tell GALL */
discord.on("guildUpdate", async (guild) => { await gall.addGuild(guild.id); });
discord.on("guildDelete", async (guild) => { await gall.removeGuild(guild.id); });

/** If a guild creates, updates or deletes a emoji we need to update gall so it can modify the reactions */
discord.on('emojiCreate', async (emoji) => {
    await gall.createEmoji({ 
        guild_id: emoji.guild.id,
        id: emoji.id,
        name: emoji.name,
        animated: emoji.animated 
    });
});
discord.on('emojiDelete', async (emoji) => { await gall.deleteEmoji(emoji.id); });
discord.on('emojiUpdate', async (oldEmoji, emoji) => {
    await gall.updateEmoji({ 
        id: emoji.id, 
        name: emoji.name,
        animated: emoji.animated 
    });
});

/**
 * @param {Discord.TextChannel} channel the discord channel
 * @param {Gallery} gallery the gallery
 */
async function sendGalleryMessage(channel, gallery, editMessage = null) {
    console.log('posting', gallery);
    const img = proxyImage(gallery.cover.origin);

    //const content = `**GALL Post**\n${process.env.GALL_URL}gallery/${gallery.id}/\n${img}`;
    const content = `${process.env.GALL_URL}gallery/${gallery.id}/?v=1`;
        
    let message = null;
    if (editMessage) {
        message = editMessage;
        await editMessage.edit(content);
    } else {
        message = await channel.send(content);
    }
    message.react('🔥');
    return message;
}

function proxyImage(url) {
    return process.env.GALL_URL + "api/proxy?url=" + encodeURIComponent(url);
}

/** Finds a gallery from the given message and channel ids */
async function findGalleryFromMessageIds(message_id, channel_id) {
    if (!galleryCache.has(message_id)) {
        let gallery = null;

        //Search for the galleries
        const galleries = await gall.findGalleries(message_id);
        if (galleries.length > 0) {
            gallery = galleries[0];
        } else {
            
            //Lets see if it has an appropriate regex
            const channel = await discord.channels.fetch(channel_id);
            if (channel) {
                const message = await channel.messages.fetch(message_id);
                if (message && message.content) {
                    gallery = await findGalleryFromMessageContent(message.content);
                }
            }
        }

        //Set the cache
        galleryCache.set(message_id, gallery);
    }
    
    //Finally return the cached value
    return galleryCache.get(message_id);
}

async function findGalleryFromMessageContent(content) {
    let uriIndex = content.indexOf(process.env.GALL_URL);
    if (uriIndex >= 0) {
        //Search from that point onwards for a GALL specific pattern (/gallery/id/)
        // If we find a matching gallery, we will fetch it from the API and store that
        const subcontent = content.substr(uriIndex);
        const regex = /gallery\/(\d*)\/?/;
        const matches = subcontent.match(regex);
        if (!matches) return null;
        return await gall.getGallery(matches[1]);
    }

    return null;
}

discord.login(process.env.BOT_TOKEN);