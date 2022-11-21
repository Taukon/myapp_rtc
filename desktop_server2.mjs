// sudo apt install libx11-dev libjpeg-dev libxtst-dev

import { Server } from "socket.io";
const io = new Server();
import nutjs from "@nut-tree/nut-js";
const { mouse, Point, Button, keyboard, Key } = nutjs;
import bindings from 'bindings';
const screenshot = bindings('screenshot');
import { exec } from "child_process";

let port = 5900;
if (process.argv[2]){
    port = process.argv[2];
    //console.log(process.argv[2]);
}
let preImg = new Buffer.alloc(0);   // --- Screen Image Buffer jpeg 

const interval = 100;//300;
let intervalId;

let ffmpegPS;   // ---ffmpeg process
// --- for ffmpeg
const pulseAudioDevice = 1;
// --- end ffmpeg

io.on('connection', socket => {

    sendScreen(socket.id);

    socket.on('data', msg => {
        const data = JSON.parse(msg.toString("utf-8"));

        // ----------- Work nut-js ------------------
        if (data.move != undefined) {
            try {
                mymoveMouse(data.move.x, data.move.y);
                //console.log("try: "+data.move.x +" :"+ data.move.y);
            } catch (error) {
                console.error(error);
            }
        }
        else if (data.leftclick != undefined) {
            try {
                if (data.leftclick == "down") {
                    mouse.pressButton(Button.LEFT);
                } else if (data.leftclick == "up") {
                    mouse.releaseButton(Button.LEFT);
                }
                //console.log("try leftclick: " + data.leftclick);
            } catch (error) {
                console.error(error);
            }
        }
        else if (data.rightclick != undefined) {
            try {
                mymouseClick(Button.RIGHT);
                //console.log("try rightclick: " + data.rightclick);
            } catch (error) {
                console.error(error);
            }
        }
        if (data.wheel != undefined) {
            try {
                if (data.wheel > 0) {
                    mouse.scrollDown(data.wheel);
                } else {
                    mouse.scrollUp(-1 * data.wheel);
                }
                //console.log("wheel: "+ data.wheel);
            } catch (error) {
                console.error(error);
            }
        }
        else if (data.key != undefined) {
            try {
                if (data.key.symbol != undefined) {
                    mykeyType(data.key.key, data.key.updown);
                } else {
                    mykeyToggle(data.key.key, data.key.updown, data.key.mod);
                }
                //console.log("try key: " + JSON.stringify(data.key));

            } catch (error) {
                console.error(error);
            }
        }
        // ---------------------------------------------
    });

    socket.on('audio', msg => {
        console.log(msg);
        ffmpegPS = exec(
            "ffmpeg -f pulse -i " + pulseAudioDevice + " -map 0:a:0 -acodec libopus -ab 128k -ac 2 -ar 48000 -f tee \"[select = a: f = rtp: ssrc = 11111111: payload_type = 101]rtp://" + msg.ip_addr + ":" + msg.rtp + "?rtcpport=" + msg.rtcp + "\""
        );
    })

    socket.on("disconnect", () => {
        if(ffmpegPS != null){
            try {
                const pid = ffmpegPS.pid;
                process.kill(pid + 1);
                process.kill(pid);
                console.log("delete ffmpeg process Id: " + pid + ", " + (pid + 1));
            } catch (error) {
                console.log(error);
            }
        }

        console.log("disconnect clear intervalId: " +intervalId);
        clearInterval(intervalId);
    });
})

io.listen(port);
console.log('listening on port ' + port);


async function sendScreen(socketId){

    let data = {
        width: screenshot.getWidth(),
        height: screenshot.getHeight(),
        depth: screenshot.getDepth(),
        fb_bpp: screenshot.getFb_bpp()
    };
    io.to(socketId).emit("screenData", data);

    intervalId = setInterval(() => {
        const img = screenshot.screenshot();

        if (Buffer.compare(img, preImg) != 0) {
            io.to(socketId).emit("img", img);
            //dataProducer.send(img);
            preImg = new Buffer.from(img.buffer);
        }

    }, interval);
}

// --- functions of nut-js ---

async function mymoveMouse(x, y) {
    const target = new Point(x, y);
    await mouse.setPosition(target);
}

async function mymouseClick(button) {
    await mouse.pressButton(button);
    mouse.releaseButton(button);
}

async function mykeyToggle(key, updown, mod) {
    if (key != undefined) {
        mod.unshift(key);
    }

    if (updown == "down") {
        await mykeyPress(mod);
    } else if (updown == "up") {
        await mykeyRelease(mod);
    }
}

async function mykeyPress(key) {

    //console.log("down: "+JSON.stringify(key));
    switch (key.length) {
        case 1:
            await keyboard.pressKey(Key[key[0]]);
            break;
        case 2:
            await keyboard.pressKey(Key[key[1]], Key[key[0]]);
            break;
        case 3:
            await keyboard.pressKey(Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
        case 4:
            await keyboard.pressKey(Key[key[3]], Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
    }
}

async function mykeyRelease(key) {

    //console.log("up: " + JSON.stringify(key));
    switch (key.length) {
        case 1:
            await keyboard.releaseKey(Key[key[0]]);
            break;
        case 2:
            await keyboard.releaseKey(Key[key[1]], Key[key[0]]);
            break;
        case 3:
            await keyboard.releaseKey(Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
        case 4:
            await keyboard.releaseKey(Key[key[3]], Key[key[2]], Key[key[1]], Key[key[0]]);
            break;
    }
}

async function mykeyType(key, updown) {
    if (updown == 'down') {
        await keyboard.type(key);
        console.log('type: ' + key);
    }
}
