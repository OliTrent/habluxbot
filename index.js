
/**
 * Discord Event DM Bot (Role-based opt-out)
 * - Members are opted-in by default
 * - Opt-out is handled by a role (OPTOUT_ROLE_ID)
 * - Admins use /eventpost with just: title + description
 * - Sends a nice embed + a button linking to https://hablux.pw
 *
 * Required env vars in .env:
 *   DISCORD_TOKEN=...
 *   GUILD_ID=1444927902004023298
 *   OPTOUT_ROLE_ID=1458526968625762326
 */

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

// ---- Config validation ----
const required = ["DISCORD_TOKEN", "GUILD_ID", "OPTOUT_ROLE_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing ${key} in environment (.env).`);
    process.exit(1);
  }
}

const GUILD_ID = process.env.GUILD_ID;
const OPTOUT_ROLE_ID = process.env.OPTOUT_ROLE_ID;

// ---- Client ----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// ---- Register slash commands to a single guild (instant updates) ----
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
      .setDescription("DM all members except those opted out.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((opt) =>
        opt.setName("title").setDescription("Event title").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("description").setDescription("Event description").setRequired(true)
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: commands,
  });

  console.log("✅ Slash commands registered for guild:", GUILD_ID);
}

// ---- Helpers ----
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildEventMessage({ title, description }) {
  // Nice embed
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Opt out anytime with /dmopt out" })
    // Pick any colour you like (gold-ish)
    .setColor(0xf5a623);

  // Button linking to your site
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Hablux.pw")
      .setStyle(ButtonStyle.Link)
      .setURL("https://hablux.pw")
  );

  return { embeds: [embed], components: [row] };
}

// ---- Events ----
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // /dmopt in|out
    if (interaction.commandName === "dmopt") {
      const choice = interaction.options.getString("choice", true);

      const role = interaction.guild.roles.cache.get(OPTOUT_ROLE_ID);
      if (!role) {
        return interaction.reply({
          content: "❌ Opt-out role not found. Check OPTOUT_ROLE_ID.",
          ephemeral: true,
        });
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (choice === "out") {
        await member.roles.add(OPTOUT_ROLE_ID);
        return interaction.reply({
          content: "🛑 You’re opted out. You won’t receive event DMs.",
          ephemeral: true,
        });
      } else {
        await member.roles.remove(OPTOUT_ROLE_ID);
        return interaction.reply({
          content: "✅ You’re opted in. You’ll receive event DMs.",
          ephemeral: true,
        });
      }
    }

    // /eventpost (admins)
    if (interaction.commandName === "eventpost") {
      const title = interaction.options.getString("title", true);
      const description = interaction.options.getString("description", true);

      // Acknowledge quickly (DMing can take time)
      await interaction.reply({
        content: "📨 Sending event DMs to eligible members…",
        ephemeral: true,
      });

      // Make sure the role exists
      const role = interaction.guild.roles.cache.get(OPTOUT_ROLE_ID);
      if (!role) {
        return interaction.followUp({
          content: "❌ Opt-out role not found. Check OPTOUT_ROLE_ID.",
          ephemeral: true,
        });
      }

      // Ensure we have a full member list cached to evaluate roles
      await interaction.guild.members.fetch();

      const eligible = interaction.guild.members.cache.filter(
        (m) => !m.user.bot && !m.roles.cache.has(OPTOUT_ROLE_ID)
      );

      const dmPayload = buildEventMessage({ title, description });

      let sent = 0;
      let failed = 0;

      // Throttle to avoid rate-limit pain
      // (For huge servers, we can improve this further)
      for (const [, member] of eligible) {
        try {
          await member.send(dmPayload);
          sent++;
          await sleep(1200);
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

// ---- Start ----
client.login(process.env.DISCORD_TOKEN);
