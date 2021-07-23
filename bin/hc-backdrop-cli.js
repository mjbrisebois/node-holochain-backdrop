const path				= require('path');
const logger				= require('@whi/stdlog');
const log				= logger(path.basename( __filename ), {
    level: process.env.LOG_LEVEL || 'fatal',
});


// const print				= require('@whi/printf');
const { Command, Option }		= require('commander');
const { Holochain }			= require('../src/index.js');


function increaseTotal ( v, total ) {
    return total + 1;
}

function detect_level ( level, default_level ) {
    let lvl		= default_level;

    if ( log[ level ] !== undefined )
	lvl		= level;
    else if ( level === "trace" )
	lvl		= "silly";

    return lvl;
}

const COLORS				= logger.COLOR_CONFIG;
function level_color ( level ) {
    return COLORS[`${level.trim()}_LEVEL`]	|| "";
}
function msg_color ( level ) {
    return COLORS[`${level.trim()}_MESSAGE`]	|| "";
}

let verbosity				= 0;
const log_levels			= {
    fatal: 0,
    error: 1,
    warn: 2,
    normal: 3,
    info: 4,
    debug: 5,
    silly: 6,
};
function should_i_log ( level ) {
    return verbosity > log_levels[ level ];
}

function holochain_log ( prefix, parts ) {
    if ( parts.level === null ) {
	return console.error(
	    `%s %s\x1b[0;97m %s\x1b[0m`,
	    parts.date.toISOString(),
	    prefix,
	    parts.message
	);
    }

    let lvl				= detect_level( parts.level, "normal" )
    if ( should_i_log( lvl ) === false )
	return;

    lvl					= ("  " + lvl).slice( -6 ).toUpperCase();
    console.error(
	`%s %s\x1b[0m %s%s\x1b[0m | \x1b[36m%s\x1b[39m | %s%s\x1b[0m`,
	parts.date.toISOString(),
	prefix,
	level_color( lvl ),
	lvl,
	parts.context,
	msg_color( lvl ),
	parts.message
    );
}

function print ( msg ) {
    process.stdout.write(`\x1b[37m${msg}\x1b[0m\n`);
}


async function main ( args ) {
    const program			= new Command();

    program
	.version("0.1.0")
	.option("-v, --verbose", "increase logging verbosity", increaseTotal, 2 )
	.option("-q, --quiet", "suppress all printing except for final result", false )
	.option("-p, --admin-port <port>", "set the admin port that will be saved in Conductor's config", parseInt )
	.option("-c, --config <path>", "set the config path (it will be generated if file does not exist)" )
	.hook("preAction", async function ( self, action ) {
	    const options		= self.opts();

	    verbosity			= options.verbose;
	    log.transports[0].setLevel(
		options.verbose === undefined
		    ? ( options.quiet
			? 1 // turn off 'warn' level when --quiet is used
			: 2 // show fatal, error, and warn by default
		      )
		    : options.verbose
	    );
	})
	.action(async function ( options ) {
	    async function graceful_shutdown () {
		print("\nStopping Holochain...");
		try {
		    await holochain.stop();
		} catch (err) {
		    log.error("Holochain stop raised an error: %s", err.stack );
		} finally {
		    process.off("exit", graceful_shutdown );
		    process.off("SIGINT", graceful_shutdown );
		}
	    }
	    process.once("exit", graceful_shutdown );
	    process.once("SIGINT", graceful_shutdown );

	    let holochain		= new Holochain({
		"admin_port": options.adminPort,
		"config": {
		    "path": options.config && path.resolve( process.cwd(), options.config ),
		},
	    });
	    try {
		let base_dir		= await holochain.setup();

		print(`Starting Holochain in "${base_dir}"...`);
		await holochain.start();

		holochain.on("lair:stdout", (line, parts) => {
		    holochain_log( "\x1b[39;1m     Lair STDOUT:", parts );
		});

		holochain.on("lair:stderr", (line, parts) => {
		    holochain_log( "\x1b[31;1m     Lair STDERR:", parts );
		});

		holochain.on("conductor:stdout", (line, parts) => {
		    holochain_log( "\x1b[39;1mConductor STDOUT:", parts );
		});

		holochain.on("conductor:stderr", (line, parts) => {
		    holochain_log( "\x1b[31;1mConductor STDERR:", parts );
		});

		await holochain.ready();
		print(`Holochain is ready`);

		await holochain.close();
	    } finally {
		print("Running cleanup...");
		await graceful_shutdown();
	    }
	})
	.allowExcessArguments( false );

    log.info("Parsing args: %s", args );
    await program.parseAsync( args );

    const options			= program.opts();
}


if ( require.main === module ) {
    log.normal("Running as CLI interface");
    main( process.argv )
	.catch( console.error );
}


module.exports = {
    main,
};
