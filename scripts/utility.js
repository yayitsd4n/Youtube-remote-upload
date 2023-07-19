// Prints to the console one character at a time from "text" at the rate of "speedMS"
async function animateText(text, speedMS) {
    await new Promise(async resolve => setTimeout(resolve, speedMS));
    process.stdout.write(text.charAt(0));
    
    if (text.length === 1) {
        process.stdout.write(`\n`);
        return;
    } else {
        return animateText(text.slice(1), speedMS);
    }
}

/*
    * Prints textFrames[i] to the console at the rate of "speedMS"
    * Once it reaches the end of the array, it continues from the beginning
    * Used to make a loading spinner
    * 
    * Returns a function to stop the animation
*/
function loadingText(textFrames, speedMS) {
    let i = 0;
    const animation = setInterval(() => {
        process.stdout.write(`\r${textFrames[i++ % textFrames.length]}`);
    }, speedMS);

    return () => {
        clearInterval(animation);
        process.stdout.write(`\n`);
    };
}

export {
    animateText,
    loadingText
}