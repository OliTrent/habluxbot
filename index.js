require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

/**
 * CONFIG (hardcoded IDs as requested)
 */
const GUILD_ID = "1444927902004023298";
const OPTOUT_ROLE_ID = "1458526968625762326";

/**
 * BRANDING
 */
const BRAND_NAME = "Hablux";
const BRAND_URL = "https://hablux.pw";
const BRAND_LOGO =
  "https://media.discordapp.net/attachments/1444932311505178696/1448347293572137162/Hablux25_Logo_byLFM.png?format=webp&quality=lossless&width=359&height=84";

// Blue theme
const THEME_BLUE = 0x2f80ed; // nice clean blue

/**
 * BASIC ENV CHECK
 */
if (!process.env.DISCORD_TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

/**
 * CLIENT
 * GuildMembers intent is needed to check roles across the server.
 */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

/**
 * Register slash commands to a single guild (fast updates)
 */
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("dmopt")
      .setDescription("Opt in/out of event DMs (opted in by default).")
      .addStringOption((opt) =>
        opt
          .setName("choice")
          .setDescription("Choose in or out")
          .setRequired(true)
          .addChoices(
            { name: "in (receive event DMs)", value: "in" },
            { name: "out (stop event DMs)", value: "out" }
          )
      ),

    new SlashCommandBuilder()
      .setName("eventpost")
      .setDescription("Send a styled event DM (opt-out role respected).")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((opt) =>
        opt.setName("title").setDescription("Nice event title").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("description")
          .setDescription("Event description (what’s happening, when, where, etc.)")
          .setRequired(true)
      )
      .addBooleanOption((opt) =>
        opt
          .setName("test")
          .setDescription("If true, sends ONLY to you (recommended before blasting everyone).")
          .setRequired(false)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: commands,
  });

  console.log("✅ Slash commands registered for guild:", GUILD_ID);
}

/**
 * Helpers
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildEventDM({ title, description, guildName }) {
  // Better looking text layout:
  // - use spacing
  // - clear headings
  // - short call-to-action line
  const prettyDescription = [
    description.trim(),
    "",
    "—",
    `🔔 **Keep updated:** You’re receiving this because you haven’t opted out.`,
    `🛑 **Opt out anytime:** Use \`/dmopt out\` in **${guildName || "the server"}**.`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(THEME_BLUE)
    .setAuthor({ name: `${BRAND_NAME} • Event Announcement`, iconURL: BRAND_LOGO, url: BRAND_URL })
    .setTitle(title)
    .setDescription(prettyDescription)
    .setThumbnail(BRAND_LOGO)
    .setTimestamp(new Date())
    .setFooter({ text: `${BRAND_NAME} Events`, iconURL: BRAND_LOGO });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Hablux.pw").setStyle(ButtonStyle.Link).setURL(BRAND_URL)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Events
 */
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    /**
     * /dmopt in|out
     */
    if (interaction.commandName === "dmopt") {
      const choice = interaction.options.getString("choice", true);

      const role = interaction.guild.roles.cache.get(OPTOUT_ROLE_ID);
      if (!role) {
        return interaction.reply({
          content: "❌ Opt-out role not found. Check OPTOUT_ROLE_ID in the code.",
          ephemeral: true,
        });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (choice === "out") {
        await member.roles.add(OPTOUT_ROLE_ID);
        return interaction.reply({
          content: "🛑 You’re opted **out** — you won’t receive event DMs.",
          ephemeral: true,
        });
      } else {
        await member.roles.remove(OPTOUT_ROLE_ID);
        return interaction.reply({
          content: "✅ You’re opted **in** — you will receive event DMs.",
          ephemeral: true,
        });
      }
    }

    /**
     * /eventpost title description test?
     */
    if (interaction.commandName === "eventpost") {
      const title = interaction.options.getString("title", true);
      const description = interaction.options.getString("description", true);
      const isTest = interaction.options.getBoolean("test") ?? false;

      // Quick ack (DM sends can take time)
      await interaction.reply({
        content: isTest
          ? "🧪 Test mode: sending the event DM to **you only**…"
          : "📨 Sending event DMs to eligible members…",
        ephemeral: true,
      });

      // Ensure opt-out role exists
      const optOutRole = interaction.guild.roles.cache.get(OPTOUT_ROLE_ID);
      if (!optOutRole) {
        return interaction.followUp({
          content: "❌ Opt-out role not found. Check the OPTOUT_ROLE_ID in index.js.",
          ephemeral: true,
        });
      }

      const dmPayload = buildEventDM({
        title,
        description,
        guildName: interaction.guild?.name,
      });

      /**
       * TEST MODE (only DM the admin who ran the command)
       */
      if (isTest) {
        try {
          await interaction.user.send(dmPayload);
          return interaction.followUp({
            content: "✅ Test DM sent to you successfully.",
            ephemeral: true,
          });
        } catch {
          return interaction.followUp({
            content:
              "❌ I couldn’t DM you (your DMs might be closed). Try enabling DMs from server members.",
            ephemeral: true,
          });
        }
      }

      /**
       * LIVE MODE (DM everyone except bots + opt-out role)
       */
      await interaction.guild.members.fetch();

      const eligible = interaction.guild.members.cache.filter(
        (m) => !m.user.bot && !m.roles.cache.has(OPTOUT_ROLE_ID)
      );

      let sent = 0;
      let failed = 0;

      for (const [, member] of eligible) {
        try {
          await member.send(dmPayload);
          sent++;
          await sleep(1200); // gentle throttle for rate limits
        } catch {
          failed++;
        }
      }

      await interaction.followUp({
        content: `✅ Done. Sent: **${sent}** | Failed/DMs closed/etc: **${failed}**`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("❌ Error:", err);
    if (!interaction.replied) {
      await interaction.reply({ content: "Something went wrong.", ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
