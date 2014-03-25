/*jslint node: true */
'use strict';

var https = require('https'),
    OAuth = require('oauth').OAuth,
    EventEmitter = require('events').EventEmitter,
    util = require('util');

function TwitterStreamClient(options, proxy) {
    this.config = {};
    this.twitterKeepaliveTimeout = null;
    this.request = null;
    this.missedTweetsTotal = 0;

    EventEmitter.call(this);

    if (undefined !== options && undefined !== options.OAuth &&
        options.OAuth.consumerKey !== null && options.OAuth.consumerSecret !== null &&
        options.keywords !== null && options.accessToken !== null &&
        options.accessTokenSecret !== null) {
        this.config = {
            twitter: {
                OAuth: {
                    tokenRequestUrl: options.OAuth.tokenRequestUrl ||  'https://twitter.com/oauth/request_token',
                    tokenAccessUrl: options.OAuth.tokenAccessUrl ||  'https://twitter.com/oauth/access_token',
                    consumerKey: options.OAuth.consumerKey ||  null,
                    consumerSecret: options.OAuth.consumerSecret ||  null,
                    version: options.OAuth.version ||  '1.0A',
                    authorizeCallback: options.OAuth.authorizeCallback ||  null,
                    signatureMethod: options.OAuth.signatureMethod ||  'HMAC-SHA1'
                },
                keepAliveTime: options.keepAliveTime ||  64000,
                trackRequest: options.trackRequest ||  '/1.1/statuses/filter.json?stall_warnings=true&track',
                keywords: options.keywords,
                host: options.host ||  'stream.twitter.com',
                port: options.port ||  '443',
                accessToken: options.accessToken,
                accessTokenSecret: options.accessTokenSecret
            },
            proxy: proxy ||  false
        };
    } else {
        console.log(this.config);
        throw 'Twitter Stream Client config elements missing';
    }
}
util.inherits(TwitterStreamClient, EventEmitter);

// Close connection to Twitter Stream API
TwitterStreamClient.prototype.disconnect = function() {
    clearTimeout(this.twitterKeepaliveTimeout);
    if (this.request !== undefined) {
        this.request.abort();
    }

    console.log('disconnected from Twitter API');
};

TwitterStreamClient.prototype.twitterDownAlert = function() {
    console.error('Twitter seems to be down');
    this.emit('twitterdown');
    this.disconnect();
    this.connect();
};

TwitterStreamClient.prototype.restartTwitterKeepAlive = function() {
    clearTimeout(this.twitterKeepaliveTimeout);
    this.twitterKeepaliveTimeout = setTimeout(this.twitterDownAlert.bind(this), this.config.twitter.keepAliveTime);
};

TwitterStreamClient.prototype.openTwitterSocket = function(socket) {
    var oauth = new OAuth(
        this.config.twitter.OAuth.tokenRequestUrl,
        this.config.twitter.OAuth.tokenAccessUrl,
        this.config.twitter.OAuth.consumerKey,
        this.config.twitter.OAuth.consumerSecret,
        this.config.twitter.OAuth.version,
        this.config.twitter.OAuth.authorizeCallback,
        this.config.twitter.OAuth.signatureMethod
    ),
        requestPath = this.config.twitter.trackRequest + '=' + encodeURIComponent(this.config.twitter.keywords),
        url = 'https://' + this.config.twitter.host + ':' + this.config.twitter.port + requestPath,
        options = {
            path: requestPath,
            host: this.config.twitter.host,
            headers: {
                'Authorization': oauth.authHeader(url, this.config.twitter.accessToken, this.config.twitter.accessTokenSecret, 'GET')
            },
            agent: false
        };

    if (socket !== undefined) {
        socket.setKeepAlive(true);
        options.socket = socket;
    }

    this.request = https.get(options, function(response) {
        var data = '',
            tweetSeparator = '\r\n',
            index,
            tweet;
        console.log('Connected to Twitter streaming API');
        this.emit('connected');
        this.restartTwitterKeepAlive();

        response.on('data', function(chunk) {
            this.restartTwitterKeepAlive();
            data += chunk.toString('utf8');

            do {
                index = data.indexOf(tweetSeparator);
                tweet = data.slice(0, index);
                data = data.slice(index + tweetSeparator.length);

                if (tweet.length > 0) {
                    try {
                        tweet = JSON.parse(tweet);

                        if (tweet !== undefined && tweet.user !== undefined && tweet.text !== undefined) {
                            this.emit('newtweet', tweet);
                        } else {
                            this.emit('missedtweets', tweet.limit.track - this.missedTweetsTotal);
                            this.missedTweetsTotal = tweet.limit.track;
                        }
                    } catch (error) {
                        console.log(error.message);
                    }
                }
            } while (index > -1);
        }.bind(this));
    }.bind(this));

    this.request.on('error', function(error) {
        console.log(error.message);
        this.emit('twittererror', error);
        throw 'error while connecting to Twitter API: ' + error.code;
    }.bind(this));

    this.request.end();
};

TwitterStreamClient.prototype.connect = function() {
    if (!this.config.proxy) {
        console.log('connect to Twitter Stream API no proxy');
        this.openTwitterSocket();
    } else {
        var proxyRequest = null;
        console.log('connect to Twitter Stream API through proxy');
        proxyRequest = require('http').request({
            host: this.config.proxy.host,
            port: this.config.proxy.port,
            method: 'CONNECT',
            path: this.config.twitter.host + ':' + this.config.twitter.port
        });

        proxyRequest.on('error', function(e) {
            throw 'Can not connect to proxy : ' + e.code;
        });

        proxyRequest.on('connect', function(response, proxySocket) {
            this.openTwitterSocket(proxySocket);
        }.bind(this)).end();
    }
};

module.exports = TwitterStreamClient;