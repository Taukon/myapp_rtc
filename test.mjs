import { exec } from "child_process";
import { createSocket } from "dgram";

// Produce our rtp video.
exec(
    "ffmpeg -re -f lavfi -i testsrc=size=640x480:rate=30 -vcodec libvpx -cpu-used 5 -deadline 1 -g 10 -error-resilient 1 -auto-alt-ref 1 -f rtp rtp://127.0.0.1:5030"
);
const udp = createSocket("udp4");
udp.bind(5030);

udp.addListener("message", (data) => {
    console.log(data);
});