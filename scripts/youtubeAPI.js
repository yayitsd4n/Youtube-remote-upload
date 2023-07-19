import fs from 'fs';
import open from 'open';
import readline from 'readline';
import fetch from "node-fetch";
import http from "http";
import { URL } from 'url';
import { google } from 'googleapis';
import { animateText, loadingText } from './utility.js';
import inquirer from 'inquirer';

/*
    A wrapper for the Google OAuth2 client and YouTube API
    * Gets consent or reuses authorization (via refresh token) with OAuth2 on init
    * 
    * Exposes a function to upload a video to YouTube
    * Exposes the refresh token to save to the local file system for later use
      so the user doesn't have to reauthorize
*/
export default class YoutubeAPI {
    #oauth2Client;
    #youTubeAPI;

    constructor(clientId, clientSecret, redirectURL, refreshToken = null) {
        this.#oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            redirectURL
        );
        
        this.refreshToken = refreshToken;
    }

     /*
        * If we have a refresh token:
            * Set it on #oAuth2Client
            * Check if the refresh token is still valid
            * If the token is valid, initialize the youTubeAPI
        * If we don't have refresh token or the one we have is invalid:
            * Kick off the oAuth process
    */
    async init() {
        if (this.refreshToken) {
            this.#oauth2Client.setCredentials({
                refresh_token: this.refreshToken
            });

            if (await this.#isValid()) {
                this.#youTubeAPI = google.youtube({
                    version: 'v3',
                    auth: this.#oauth2Client
                });
            } else {
                await this.#authorize();
            }

        } else {
            await this.#authorize();
        }
    }

    /*
        * Uploads a video to YouTube with the YouTube API
        * Waits until the video is finished processing
        * Returns the id of the video
    */
    async uploadVideo (fileName, videoDetails) {
        
        /*
            Using the YouTube API:
            * Uploads a video to YouTube
            * Logs the upload progress to the console
            * 
            * Returns the video id once it is finished uploading
        */
        const upload = async (fileName, {snippet, status}) => {
            const fileSize = fs.statSync(fileName).size;
            
            try {
                return (await this.#youTubeAPI.videos.insert(
                    {
                        part: 'snippet, status',
                        notifySubscribers: false,
                        requestBody: {
                            snippet,
                            status
                        },
                        media: {
                            body: fs.createReadStream(fileName),
                        }
                    },
                    {
                        onUploadProgress: evt => {
                            const progress = Math.round((evt.bytesRead / fileSize) * 100);
                            readline.clearLine(process.stdout, 0);
                            readline.cursorTo(process.stdout, 0, null);

                            if (progress === 100) {
                                process.stdout.write(`${progress}% complete`);
                            } else {
                                process.stdout.write(`${progress}% complete`);
                            }
                        }
                    }
                )).data.id;

            } catch (error) {
                console.error(error);
                throw(error);
            }
        }
        
        /*
            * Pulls the uploaded video data
                * Checks to see if the video is finished processing
            * Pulls the thumbnail location until it is finished processing
            * 
            * Returns a promise that resolves once the video is finished processing
        */
        const processing = async (id, timeLeftMs = 3000) => {
            /*
                Using the YouTube API:
                * Gets the location of the high resolution thumbnail
                * Recursively checks if the thumbnail has been processed 
            */
            const checkThumbnailProcessing = async () => {
                await new Promise(resolve => setTimeout(resolve, 5000));

                let details = await this.#youTubeAPI.videos.list({
                    part: 'processingDetails, snippet',
                    id,
                });

                const video = details?.data?.items[0];
                const thumbnailURL = video?.snippet?.thumbnails?.high?.url;
                if (thumbnailURL) {
                    try {
                        let response = await fetch(thumbnailURL);

                        if (!response.ok) {
                            return checkThumbnailProcessing();
                        } else {
                            return;
                        }

                    } catch (error) {
                        console.log('thumbnail error', error);
                        return checkThumbnailProcessing();
                    }
                    
                }
            }

            /*
                Using the YouTube API:
                * Gets the video data of the uploaded video
                * Recursively checks if the video has been processed 
            */
            const checkVideoProcessing = async timeLeftMs => {
                await new Promise(async resolve => setTimeout(resolve, timeLeftMs));
                
                // A call to YouTube api to give us a list of videos by id
                let details = await this.#youTubeAPI.videos.list({
                    part: 'processingDetails, snippet',
                    id,
                });

                // There should only be one id that matches, so get the first one in the list
                const video = details?.data?.items[0];
                if (video?.processingDetails?.processingStatus === 'succeeded') {
                    return;
                } else {
                    /*
                        * If the video is still processing, check timeLeftMs.
                            * timeLeftMs is the estimated time it will finish processing
                            * timeLeftMs will not exist if the video hasn't started processing yet
                        * Check processing again using the estimated timeLeftMs or our default one
                    */
                    const newTimeLeftMs = video?.processingDetails?.processingProgress?.timeLeftMs || timeLeftMs;
                    return checkVideoProcessing(id, newTimeLeftMs);
                }
            }


            const cancelAnimation = loadingText(["| YouTube Processing...", "/ YouTube Processing...", "- YouTube Processing...", "\\ YouTube Processing..."], 150);
            await checkVideoProcessing(timeLeftMs);
            await checkThumbnailProcessing();

            cancelAnimation();
            return;
        }

        // Combines the default video metadata with the user defined ones
        const createDetailsObject = userDefined => {
            let {snippet, status} = JSON.parse(fs.readFileSync('uploadDefaults.json'));
        
            return {
                snippet: {...snippet, ...userDefined.snippet},
                status: {...status, ...userDefined.status}
            };
        }
        
        console.log('Starting Upload');
        const detailsObj = createDetailsObject(videoDetails);
        let id = await upload(fileName, detailsObj);
        console.log('\n Finished Upload');

        await processing(id);
        console.log('YouTube Finished Processing');

        return id;
    }

    /*
        Contains the entirety of the OAuth process
        * Sets the refresh token once the user has consented
        * Sets the YouTube API once we have the refresh token
    */
    async #authorize() {
        await animateText("You'll need to give consent to post videos to your YoutTube account on your behalf.\n A browser window will open to Google's consent page. Follow the steps on that page, then you should be all set!", 10);
        await inquirer.prompt(
            {
                type: 'input',
                name: 'continue',
                message: 'Press Enter to continue'
            }
        );
        
        /*
            * Starts the OAuth process
            * 
            * Returns the refresh token
        */
        const doOAuth = async () => {
            let authToken;
            // Uses the google oauth client to generate a url for the user to visit and give consent
            const consentURL = this.#oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"],
                prompt: 'consent'
            });

            /*
                Spin up a server that listens for a callback from the google consent process
                * If the callback has 'code' as part of its query params, then the consent process 
                was successful
                * If the callback has 'error' as part of its query params, then the user canceled
                the consent process
                *
                * Returns a promise that resolves to the authorization token
            */
            const getAuthToken = async url => {
                return new Promise((resolve, reject) => {
                    const server = http.createServer(async (req, res) => {
                        try {
                            if (req.url.indexOf("/oauth2callback") > -1) {
                                const myURL = new URL(req.url, `http://${req.headers.host}`);
                                const error = myURL.searchParams.get('error');
                                const code = myURL.searchParams.get('code');                            

                                if (code) {
                                    res.end('Authentication successful! Please return to the console.');
                                    server.close();
                                    resolve(code);
                                }

                                if (error) {
                                    res.end('Authentication canceled. Please return to the console.');
                                    server.close();
                                    reject(error);
                                }
                            }
                        } catch (e) {
                            reject(e);
                        }
                    }).listen(3000, () => {
                        console.log('listening');
                        open(url);
                    });
                });
            }

            // A function that instructions the user that they need to give consent, then recalls doOAuth()
            const redoConsent = async () => {
                console.error("You need to give consent to both items. A browser window will open to Google's consent page asking you to consent to both items.");
                await inquirer.prompt(
                    {
                        type: 'input',
                        name: 'continue',
                        message: 'Press Enter to continue'
                    }
                );
                return doOAuth();
            }

            /*
                * Starts the google OAuth process on their website
                * If the user doesn't give consent, then we ask for it again
            */
            try {
                authToken = await getAuthToken(consentURL);
            } catch (error) {
                return redoConsent();
            }
            
            // Once we have the auth token, we exchange it for the refresh token
            const { tokens } = await this.#oauth2Client.getToken(authToken);
            
            /*
                * Checks to see if we have consent to both scopes.
                * If we don't, then ask the user to give consent again
            */
            try {
                const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${tokens.access_token}`);
                const data = await response.json();
                
                const scopes = data.scope.split(" ");
                if (scopes.length < 2) {
                    return redoConsent();
                }
            } catch (error) {
                console.log('error', error);
            }
            
            return tokens;
        }

        const tokens = await doOAuth();
        this.#oauth2Client.setCredentials(tokens);
        this.refreshToken = tokens.refresh_token;

        this.youtubeApi = google.youtube({
            version: 'v3',
            auth: this.#oauth2Client
        });
    }

    /*
        * Checks to see if the refreshtoken is valid
        * A token can be invalid if the user revokes consent at some point after giving it
        * 
        * Returns a promise that will resolve to true or false
    */
    #isValid() {
        return new Promise(res => {
            this.#oauth2Client.refreshAccessToken(error => {
                if (error) {
                    res(false);
                } else {
                    res(true);
                }
            });
        });
    }
}