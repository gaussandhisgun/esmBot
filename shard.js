// shard base
const { Base } = require("eris-sharder");
// path stuff
const { readdir } = require("fs").promises;
// fancy loggings
const logger = require("./utils/logger.js");
// initialize command loader
const handler = require("./utils/handler.js");
// lavalink stuff
const sound = require("./utils/soundplayer.js");
// image processing stuff
const image = require("./utils/image.js");
// database stuff
const database = require("./utils/database.js");
// command collections
const collections = require("./utils/collections.js");
// playing messages
const messages = require("./messages.json");
// other stuff
const misc = require("./utils/misc.js");
// generate help page
const helpGenerator =
  process.env.OUTPUT !== "" ? require("./utils/help.js") : null;

class Shard extends Base {
  constructor(bot) {
    super(bot);
  }

  async init() {
    // register commands and their info
    const soundStatus = await sound.checkStatus();
    logger.log("info", "Attempting to load commands...");
    for await (const commandFile of this.getFiles("./commands/")) {
      logger.log("log", `Loading command from ${commandFile}...`);
      try {
        await handler.load(commandFile, soundStatus);
      } catch (e) {
        logger.error(`Failed to register command from ${commandFile}: ${e}`);
      }
    }
  
    // register events
    const events = await readdir("./events/");
    logger.log("info", `Attempting to load ${events.length} events...`);
    for (const file of events) {
      logger.log("log", `Loading event from ${file}...`);
      const eventName = file.split(".")[0];
      const event = require(`./events/${file}`);
      this.bot.on(eventName, event.bind(null, this.bot));
    }
  
    // connect to image api if enabled
    if (process.env.API === "true") {
      for (const server of image.servers) {
        try {
          await image.connect(server);
        } catch (e) {
          logger.error(e);
        }
      }
    }

    // generate docs
    await helpGenerator.generateList();
    if (this.clusterID === 0 && helpGenerator) {
      await helpGenerator.createPage(process.env.OUTPUT);
      logger.log("info", "The help docs have been generated.");
    }

    // handle process stop
    process.on("SIGINT", () => {
      logger.log("warn", "SIGINT detected, shutting down...");
      this.bot.editStatus("dnd", {
        name: "Restarting/shutting down..."
      });
      for (const command in collections.commands) {
        handler.unload(command);
      }
      this.bot.disconnect();
      require("./utils/database.js").stop();
      process.exit(0);
    });
    return;
  }

  async* getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        yield* this.getFiles(dir + dirent.name);
      } else {
        yield dir + (dir.charAt(dir.length - 1) !== "/" ? "/" : "") + dirent.name;
      }
    }
  }

  async launch() {
    try {
      await this.init();
    } catch {
      logger.error("Might have failed to register some things");
    }
    
    // connect to lavalink
    if (!sound.status && !sound.connected) await sound.connect(this.bot);

    this.bot.privateChannels.limit = 0;

    await database.setup();

    // set activity (a.k.a. the gamer code)
    (async function activityChanger() {
      this.bot.editStatus("dnd", {
        name: `${misc.random(messages)} | @${this.bot.user.username} help`,
      });
      setTimeout(activityChanger.bind(this), 900000);
    }).bind(this)();

    if (process.env.PMTWO === "true") process.send("ready");
    logger.log("info", `Started cluster ${this.clusterID}.`);
  }

}

module.exports = Shard;