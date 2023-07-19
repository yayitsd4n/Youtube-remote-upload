import path from 'path';
import keytar from 'keytar';
import inquirer from 'inquirer';
import clipboard from 'clipboardy';
import YoutubeAPI from './scripts/youtubeAPI.js';


/*
    * Get the Google OAuth2 refresh token if the app has already been given consent
    * Initialize the YoutubeAPI class.
        * This will check for a refresh token. If one hasn't been saved before, this will
          kick off the OAuth consent process
    * Once we have a valid refresh token, we save it.
*/
const refreshToken = await keytar.getPassword('YouTubeRemoteUpload', 'refreshToken');
const youtubeAPI = new YoutubeAPI(
    "992571060329-bu2hjmu551856a43iuea33btgoh4lpuh.apps.googleusercontent.com",
    "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",
    "http://localhost:3000/oauth2callback",
    refreshToken
);

await youtubeAPI.init();
await keytar.setPassword('youTubeRemoteUpload', 'refreshToken', youtubeAPI.refreshToken);


/*
    * Check to see if we've recieved a path to a video in argv
        * If we have a path, set it and use it to get the file name
    * Ask the user for the videoPath, videoTitle, and videoDescription
        * Prefill the path and title if we've been given it through an argv
*/
let videoPathFromArgv= process.argv[2];
let videoTitleFromArgv;
if (videoPathFromArgv) {
    videoTitleFromArgv = path.parse(videoPathFromArgv).name;
}

let { videoPath, videoTitle, videoDescription } = await inquirer.prompt([
    {
        type: 'input',
        name: 'videoPath',
        message: 'Video Path:',
        default: videoPathFromArgv,
        filter: function(val) {
            /*  
                If the value starts and ends with a quote, remove them.
                This happens when dragging and dropping a file into the console window.
            */
            if ((val.startsWith("'") || val.startsWith("\"")) && (val.endsWith("'") || val.endsWith("\""))) {
                return val.substring(1, val.length - 1);
            }

            return val;
        }
    },
    {
        type: 'input',
        name: 'videoTitle',
        message: 'Title:',
        default: videoTitleFromArgv
    },
    {
        type: 'input',
        name: 'videoDescription',
        message: 'Description:'
    }
]);

/*
    Use the YouTube api to upload the video

    Returns the id of the video after:
        * The upload is finished
        * The video is finished processing
        * The thumbnails are finished processing
*/
const id = await youtubeAPI.uploadVideo(videoPath, {
    "snippet": {
        "title": videoTitle,
        "description": videoDescription,
    }
});

// Copy the youtube link to the clipboard it's avialable
console.log(`YouTube Link:\nhttps://www.youtube.com/watch?v=${id}`);
clipboard.writeSync(`https://www.youtube.com/watch?v=${id}`);
console.log('YouTube URL copied to clipboard');