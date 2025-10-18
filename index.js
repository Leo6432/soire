// index.js - Bot Discord Cache-Cache (version personnalisée)
// Remplace les IDs de salon et rôles selon la demande de l'utilisateur.
// Variables importantes :
// REWARDS_CHANNEL_ID -> salon où le message de la boutique / jetons sera posté
// PARTY_CHANNEL_ID   -> salon où le message 'Lancer Party' sera posté
// SEEKER_ROLE_ID     -> role ID pour chercheur (non utilisé pour création, juste pour référence)
// HIDER_ROLE_ID      -> role ID pour cacher (sera attribué aux hiders)
// Utiliser sur Replit: définir DISCORD_TOKEN dans les secrets.

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'data.json');
let DB = { guilds: {} };
if (fs.existsSync(DATA_PATH)) {
  try { DB = JSON.parse(fs.readFileSync(DATA_PATH)); } catch (e) { console.error('Impossible de lire data.json, demarrage avec DB vide', e); }
}
function saveDB(){ fs.writeFileSync(DATA_PATH, JSON.stringify(DB, null, 2)); }

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('ERREUR: définis la variable d\'environnement DISCORD_TOKEN');
  process.exit(1);
}

// --- CONFIG UTILISATEUR ---
const REWARDS_CHANNEL_ID = '1429146306131263488'; // salon boutique / jetons
const PARTY_CHANNEL_ID   = '1429131264824180860'; // salon lancer party
const SEEKER_ROLE_ID     = '1429146477552205825'; // role chercheur (id fourni)
const HIDER_ROLE_ID      = '1429146571865460757'; // role cacher (id fourni)
// --------------------------

const PRIZES = [
  'Brainrot: skin Alpha',
  'Brainrot: emote surprise',
  '50 XP',
  'Rien (mauvaise chance)'
];

const DEFAULT_CACHER_ROLE_ID = HIDER_ROLE_ID; // on utilisera ce rôle si existe

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

function ensureGuild(guildId){
  if (!DB.guilds[guildId]) DB.guilds[guildId] = { balances: {}, currentParty: null };
  return DB.guilds[guildId];
}
function giveToken(guildId, userId, amount){
  const g = ensureGuild(guildId);
  g.balances[userId] = (g.balances[userId]||0) + amount;
  saveDB();
}
function getTokens(guildId, userId){
  const g = ensureGuild(guildId);
  return g.balances[userId] || 0;
}

async function sendRewardsMessage(guild){
  try{
    const channel = guild.channels.cache.get(REWARDS_CHANNEL_ID) || await guild.channels.fetch(REWARDS_CHANNEL_ID).catch(()=>null);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle('Boutique Brainrot — Récompenses')
      .setDescription('Cliquez sur **Acheter Brainrot** pour tenter votre chance (-1 jeton). Ou utilisez **Voir mes jetons** pour afficher votre solde.')
      .addFields({ name: 'Exemples de gains', value: PRIZES.join('\n') });
    const buyBtn = new ButtonBuilder().setCustomId('buy_brainrot').setLabel('Acheter Brainrot (-1 jeton)').setStyle(ButtonStyle.Primary);
    const viewBtn = new ButtonBuilder().setCustomId('voir_jetons').setLabel('Voir mes jetons').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(buyBtn, viewBtn);
    await channel.send({ embeds: [embed], components: [row] });
  }catch(e){ console.warn('sendRewardsMessage error', e); }
}

async function sendPartyStarter(guild){
  try{
    const channel = guild.channels.cache.get(PARTY_CHANNEL_ID) || await guild.channels.fetch(PARTY_CHANNEL_ID).catch(()=>null);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle('Bienvenue dans la soirée Cache-Cache')
      .setDescription('À chaque partie gagnée, vous gagnez 1 jeton. Avec le jeton vous pouvez tenter de gagner un brainrot dans la boutique.')
      .setFooter({ text: 'Cliquez sur Lancer Party pour ouvrir les inscriptions (0/3)' });

    const lancerRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('lancer_party').setLabel('Lancer Party').setStyle(ButtonStyle.Primary)
    );
    await channel.send({ embeds: [embed], components: [lancerRow] });
  }catch(e){ console.warn('sendPartyStarter error', e); }
}

client.once(Events.ClientReady, async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  // Pour chaque guild, envoyer les messages dans les salons configurés s'ils existent
  for (const [guildId, guild] of client.guilds.cache){
    await sendRewardsMessage(guild);
    await sendPartyStarter(guild);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const guildState = ensureGuild(guildId);

  // Boutique: voir jetons
  if (interaction.customId === 'voir_jetons'){
    const tokens = getTokens(guildId, userId);
    return interaction.reply({ content: `Vous avez ${tokens} jeton(s).`, ephemeral: true });
  }

  // Boutique: acheter brainrot
  if (interaction.customId === 'buy_brainrot'){
    const tokens = getTokens(guildId, userId);
    if (tokens < 1) return interaction.reply({ content: 'Vous n\'avez pas assez de jetons.', ephemeral: true });
    giveToken(guildId, userId, -1);
    const prize = PRIZES[Math.floor(Math.random()*PRIZES.length)];
    return interaction.reply({ content: `Vous avez dépensé 1 jeton et gagné : **${prize}**`, ephemeral: true });
  }

  // Lancer Party - ouvre les inscriptions
  if (interaction.customId === 'lancer_party'){
    if (guildState.currentParty && guildState.currentParty.status === 'waiting'){
      return interaction.reply({ content: 'Une inscription est déjà ouverte.', ephemeral: true });
    }
    const party = { channelId: interaction.channelId, messageId: interaction.message.id, participants: [], status: 'waiting' };
    guildState.currentParty = party;
    saveDB();
    const participateBtn = new ButtonBuilder().setCustomId('participer_party').setLabel('Participer (0/3)').setStyle(ButtonStyle.Success);
    const cancelBtn = new ButtonBuilder().setCustomId('cancel_party').setLabel('Annuler inscription').setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(participateBtn, cancelBtn);
    return interaction.reply({ content: 'Inscriptions ouvertes — cliquez sur **Participer** pour vous inscrire ! (0/3)', components: [row] });
  }

  // Participer
  if (interaction.customId === 'participer_party'){
    const party = guildState.currentParty;
    if (!party || party.status !== 'waiting') return interaction.reply({ content: 'Pas d\'inscription ouverte.', ephemeral: true });
    if (party.participants.includes(userId)) return interaction.reply({ content: 'Vous êtes déjà inscrit.', ephemeral: true });
    party.participants.push(userId);
    saveDB();
    const count = party.participants.length;
    // update ephemeral reply to user and edit the original message content if possible
    try{ await interaction.update({ content: `Inscriptions ouvertes — ${count}/3`, components: interaction.message.components }); }catch(e){ try{ await interaction.reply({ content: `Inscriptions: ${count}/3`, ephemeral: true }); }catch(_){} }

    if (count === 3){
      // start the game
      party.status = 'starting';
      const shuffled = party.participants.sort(()=>Math.random()-0.5);
      const seeker = shuffled[0];
      const hiders = [shuffled[1], shuffled[2]];
      party.seekerId = seeker;
      party.hiders = hiders;
      party.status = 'started';
      saveDB();

      // assign cacher role to hiders (use HIDER_ROLE_ID if exists)
      try{
        const guildObj = await client.guilds.fetch(guildId);
        for (const hid of hiders){
          try{ const member = await guildObj.members.fetch(hid); if (HIDER_ROLE_ID) await member.roles.add(HIDER_ROLE_ID); }catch(e){}
        }
      }catch(e){ console.warn('assign role error', e); }

      // create a temporary voice channel for hiders (if perms allow)
      let voiceChannelId = null;
      try{
        const guildObj = await client.guilds.fetch(guildId);
        const vc = await guildObj.channels.create({ name: `Cache-${Date.now()%10000}`, type: 2 });
        voiceChannelId = vc.id;
        // allow only hiders to join (best effort)
        for (const hid of hiders){ try{ await vc.permissionOverwrites.edit(hid, { Connect: true, Speak: true }); }catch(e){} }
        party.voiceChannelId = voiceChannelId;
        saveDB();
      }catch(e){ console.warn('voice creation failed', e); }

      await interaction.followUp({ content: `Partie lancée ! Le chercheur est <@${seeker}>. Les deux autres ont le rôle <@&${HIDER_ROLE_ID}>. Compte à rebours de 30s avant l'arrivée du chercheur.` });

      // 30s countdown shown in channel
      const ch = await client.channels.fetch(party.channelId).catch(()=>null);
      if (!ch) return;
      let countdown = 30;
      const countdownMsg = await ch.send(`Temps avant l'arrivée du chercheur : ${countdown}s`);
      const cinterval = setInterval(async ()=>{
        countdown -= 5;
        if (countdown <= 0){
          clearInterval(cinterval);
          await countdownMsg.edit('Le chercheur arrive maintenant !');
          // Start 3min timer
          startRoundTimer(guildId, ch, party);
        } else {
          try{ await countdownMsg.edit(`Temps avant l'arrivée du chercheur : ${countdown}s`); }catch(e){}
        }
      }, 5000);
    }
    return;
  }

  // Annuler inscription
  if (interaction.customId === 'cancel_party'){
    const party = guildState.currentParty;
    if (!party) return interaction.reply({ content: 'Pas d\'inscription ouverte.', ephemeral: true });
    if (!party.participants.includes(userId)) return interaction.reply({ content: 'Vous n\'êtes pas inscrit.', ephemeral: true });
    party.participants = party.participants.filter(p=>p !== userId);
    saveDB();
    return interaction.reply({ content: `Vous avez annulé votre inscription. (${party.participants.length}/3)`, ephemeral: true });
  }

  // Panel button for seeker to mark found: customId = found_<userId>
  if (interaction.customId.startsWith('found_')){
    const foundUserId = interaction.customId.split('_')[1];
    const party = guildState.currentParty;
    if (!party || party.status !== 'started') return interaction.reply({ content: 'Aucune partie en cours.', ephemeral: true });
    if (interaction.user.id !== party.seekerId) return interaction.reply({ content: 'Seul le chercheur peut utiliser ce panneau.', ephemeral: true });
    party.found = party.found || [];
    if (!party.found.includes(foundUserId)) party.found.push(foundUserId);
    saveDB();
    if (party.found.length >= (party.hiders ? party.hiders.length : 2)){
      // seeker found all
      for (const hid of party.hiders){
        try{ const guildObj = await client.guilds.fetch(guildId); const member = await guildObj.members.fetch(hid); if (HIDER_ROLE_ID) await member.roles.remove(HIDER_ROLE_ID); }catch(e){}
      }
      giveToken(guildId, party.seekerId, 1);
      await interaction.channel.send(`Le chercheur a trouvé tous les cachés — tout le monde est trouvé. Le chercheur gagne 1 jeton.`);
      cleanupParty(guildId);
    } else {
      return interaction.reply({ content: `Joueur marqué comme trouvé. (${party.found.length}/${party.hiders.length})`, ephemeral: true });
    }
    return;
  }
});

async function startRoundTimer(guildId, channel, party){
  const guildState = ensureGuild(guildId);
  if (!party) party = guildState.currentParty;
  if (!party) return;
  const seeker = party.seekerId;
  // Create a control panel for seeker with buttons to mark each hider as found
  const findButtons = party.hiders.map(h=> new ButtonBuilder().setCustomId(`found_${h}`).setLabel(`J'ai trouvé <@${h}>`).setStyle(ButtonStyle.Primary));
  const row = new ActionRowBuilder().addComponents(...findButtons);
  await channel.send({ content: `<@${seeker}> panneau de recherche : cliquez quand vous avez trouvé un joueur.`, components: [row] });

  let remaining = 180; // 3 minutes
  const timerMsg = await channel.send(`Temps restant : ${remaining}s`);
  const interval = setInterval(async ()=>{
    remaining -= 10;
    if (remaining <= 0){
      clearInterval(interval);
      party.found = party.found || [];
      const survived = party.hiders.filter(h => !party.found.includes(h));
      for (const s of survived) giveToken(guildId, s, 1);
      await channel.send(`Chrono terminé ! Joueurs survivants: ${survived.map(s=>`<@${s}>`).join(', ') || 'Aucun'}. Ils gagnent 1 jeton chacun.`);
      cleanupParty(guildId);
    } else {
      try{ await timerMsg.edit(`Temps restant : ${remaining}s`); }catch(e){}
    }
  }, 10000);
  party.timers = { roundTimer: interval };
}

async function cleanupParty(guildId){
  const guildState = ensureGuild(guildId);
  const party = guildState.currentParty;
  if (!party) return;
  try{
    const guildObj = await client.guilds.fetch(guildId);
    if (HIDER_ROLE_ID && party.hiders){
      for (const hid of party.hiders){
        try{ const member = await guildObj.members.fetch(hid); if (member.roles.cache.has(HIDER_ROLE_ID)) await member.roles.remove(HIDER_ROLE_ID); }catch(e){}
      }
    }
    if (party.voiceChannelId){
      const vc = guildObj.channels.cache.get(party.voiceChannelId);
      if (vc) await vc.delete('Fin de la partie');
    }
  }catch(e){ console.warn('Erreur cleanup', e); }
  guildState.currentParty = null;
  saveDB();
}

client.on('messageCreate', async (message)=>{
  if (message.author.bot) return;
  const content = message.content.trim().toLowerCase();
  if (content === '!balance'){
    const bal = getTokens(message.guildId, message.author.id);
    return message.reply(`Vous avez ${bal} jeton(s).`);
  }
  if (content === '!boutique'){
    // send a message similar to the rewards channel buttons
    const embed = new EmbedBuilder().setTitle('Boutique Brainrot').setDescription('Acheter ou voir vos jetons.');
    const buyBtn = new ButtonBuilder().setCustomId('buy_brainrot').setLabel('Acheter Brainrot (-1 jeton)').setStyle(ButtonStyle.Primary);
    const viewBtn = new ButtonBuilder().setCustomId('voir_jetons').setLabel('Voir mes jetons').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(buyBtn, viewBtn);
    return message.reply({ embeds: [embed], components: [row] });
  }
  if (content === '!start'){
    // dev helper: re-send starter messages to configured channels
    try{
      const guild = message.guild;
      await sendRewardsMessage(guild);
      await sendPartyStarter(guild);
      return message.reply('Messages de boutique et de lancement envoyés.');
    }catch(e){ return message.reply('Erreur lors de l\'envoi.'); }
  }
});

client.login(TOKEN).catch(e=>{ console.error('Erreur de connexion au bot', e); process.exit(1); });
