const { APIPollBot } = require('./ApiPollBot');
const { MessageEmbed } = require('discord.js');
const fetch = require('node-fetch');

const {
	sendEmbedToSaleChannels,
	sendEmbedToListChannels,
	BAN_ADDRESSES,
} = require('../Utils/activityTriager');

/** API Poller for LooksRare List and Sale events */
class OpenseaAPIPollBot extends APIPollBot {
	/** Constructor just calls super
	 * @param {string} apiEndpoint - Endpoint to be hitting
	 * @param {number} refreshRateMs - How often to poll the endpoint (in ms)
	 * @param {*} bot - Discord bot that will be sending messages
	 */
	constructor(apiEndpoint, refreshRateMs, bot, headers) {
		apiEndpoint = apiEndpoint + '&occurred_after=1651681274';
		super(apiEndpoint, refreshRateMs, bot, headers);
		console.log('CREATED', apiEndpoint);
	}

	/**
	 * Parses and handles LooksRare API endpoint data
	 * Only sends events that are new
	 * Response spec: https://looksrare.github.io/api-docs/#/Events/EventController.getEvents
	 * @param {*} responseData - Dict parsed from API request json
	 */
	handleAPIResponse(responseData) {
		let maxTime = 0;
		console.log(responseData);
		for (const data of responseData.asset_events) {
			const eventTime = Date.parse(data.event_timestamp);

			// Only deal with event if it is new
			if (this.lastUpdatedTime < eventTime) {
				this.buildDiscordMessage(data);
			}

			// Save the time of the latest event from this batch
			if (maxTime < eventTime) {
				maxTime = eventTime;
			}
		}

		// Update latest time vars if batch has new latest time
		if (maxTime > this.lastUpdatedTime) {
			this.lastUpdatedTime = maxTime;
			this.apiEndpoint.split('&occurred_after=')[0] +
				'&occurred_after=' +
				this.lastUpdatedTime / 1000;
		}
	}

	/**
	 * Handles constructing and sending Discord embed message
	 * LooksRare API Spec: https://looksrare.github.io/api-docs/#/Events/EventController.getEvents
	 * @param {*} msg - Dict of event data from API response
	 */
	async buildDiscordMessage(msg) {
		// Create embed we will be sending
		const embed = new MessageEmbed();

		// Parsing LooksRare message to get info
		const tokenID = msg.asset.token_id;
		const looksRareURL = msg.asset.permalink;

		// Event_type will either be SALE or LIST
		const eventType = msg.event_type;

		// Construct price field (different info/verbiage depending on sale or list)
		let priceText, price, owner, ownerName;
		if (eventType === 'successful') {
			// Item sold, add 'Buyer' field
			embed.addField(
				'Buyer',
				msg.winner_account.address +
					' (' +
					msg.winner_account.user.username +
					')'
			);
			priceText = 'Sale Price';
			price = msg.total_price;
			owner = msg.seller.address;
			ownerName = msg.seller.user.username;
		} else {
			// Item Listed
			priceText = 'List Price';
			price = msg.ending_price;
			owner = msg.from_account.address;
			ownerName = msg.from_account.user.username;
		}

		if (BAN_ADDRESSES.has(owner)) {
			console.log(`Skipping message propagation for ${owner}`);
			return;
		}
		embed.addField('Seller (Opensea)', owner + ' (' + ownerName + ')');
		embed.addField(
			priceText,
			parseInt(price) / 1000000000000000000 + 'ETH',
			true
		);

		// Get Art Blocks metadata response for the item.
		const artBlocksResponse = await fetch(
			`https://token.artblocks.io/${tokenID}`
		);
		const artBlocksData = await artBlocksResponse.json();

		// Update thumbnail image to use larger variant from Art Blocks API.
		embed.setThumbnail(artBlocksData.image);

		// Add inline field for viewing live script on Art Blocks.
		embed.addField(
			'Live Script',
			`[view on artblocks.io](${artBlocksData.external_url})`,
			true
		);
		// Update to remove author name and to reflect this info in piece name
		// rather than token number as the title and URL field..
		embed.author = null;
		embed.setTitle(`${artBlocksData.name} - ${artBlocksData.artist}`);
		embed.setURL(looksRareURL);
		if (artBlocksData.collection_name) {
			if (eventType.includes('successful')) {
				console.log(artBlocksData.name + ' SALE');
				sendEmbedToSaleChannels(this.bot, embed, artBlocksData);
			} else if (eventType.includes('created')) {
				console.log(artBlocksData.name + ' LIST');

				sendEmbedToListChannels(this.bot, embed, artBlocksData);
			}
		}
	}
}

module.exports.OpenseaAPIPollBot = OpenseaAPIPollBot;
