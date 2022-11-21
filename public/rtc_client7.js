'use strict';

let clientList = [];
let socket = null;

function start() {
    let inputMessage = document.getElementById('inputText').value;
    if (inputMessage === '') {
        return;
    }
    // input 内のテキストを空にする
    //document.getElementById('inputText').value = '';
    //document.getElementById('sendButton').disabled = true;

    if(socket == null){
        socket = createWebSocket();
    }

    const clientRtc = new ClientRtc(inputMessage, socket);
    clientList.push(clientRtc);
    clientRtc.join();

}

function createWebSocket() {
    const sock = io('/');
    sock.on("end", () => {
        sock.close();
    })
    sock.on("disconnect", () => {
        console.log("socket closed");
        sock.close();
    })
    return sock;
}

class ClientRtc {
    constructor(inputMessage, socket) {
        this.desktopAddress = inputMessage;
        this.sock = socket;
        this.msDevice = null;

        this.msSendTransport = null;
        this.msRecvScreenTransport = null;

        //this.canvas2 = document.getElementById('screen');
        this.canvas2 = document.createElement("canvas");
        this.canvas2.setAttribute('tabindex', 0);
        document.getElementById('screen').appendChild(this.canvas2);
        clientList.forEach((value, key) => {
            if (value.desktopAddress == this.desktopAddress){
                document.getElementById('screen').removeChild(document.getElementById('screen').childNodes.item(key));
                //console.log("key: " + key + ", " + clientList[key].desktopAddress);
                //console.log(document.getElementById('screen').childNodes);
                delete clientList[key];
                clientList.splice(key, 1);
                //console.log("key2: " + key + ", " + clientList[key].desktopAddress);
            }
        })

        this.image = new Image();
        this.image.onload = () => {
            this.canvas2.width = this.image.width;
            this.canvas2.height = this.image.height;
            this.canvas2.getContext('2d').drawImage(this.image, 0, 0);
        }
    }

    async join() {
        //await this.createWebSocket();
        await this.createDevice();

        await this.createRecvScreenTransport();
        await this.createSendTransport();
        this.controlEvent()
        await this.getScreen();
    }

    async createDevice() {
        const rtpCap = await this.sendRequest('getRtpCapabilities', this.desktopAddress);
        const device = new MediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCap });
        this.msDevice = device;
    }

    // --- Producer ---

    async createSendTransport() {
        const params = await this.sendRequest('createProducerTransport', this.desktopAddress);
        const transport = this.msDevice.createSendTransport(params);

        transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            this.sendRequest('connectProducerTransport', {
                transportId: transport.id,
                dtlsParameters: dtlsParameters,
            }).then(callback)
                .catch(errback);
        });

        transport.on('producedata', async (parameters, callback, errback) => {
            try {
                const id = await this.sendRequest('produceData', {
                    transportId: transport.id,
                    produceParameters: parameters,
                    desktopAddress: this.desktopAddress,
                });
                callback({ id: id });
            } catch (err) {
                errback(err);
            }
        });

        transport.observer.on('close', () => {
            transport.close();
        });

        this.msSendTransport = transport;
    }

    async controlEvent() {
        const producer = await this.msSendTransport.produceData();
        producer.on('open', () => {

            this.canvas2.addEventListener('mousedown', (event) => {
                const data = { 'leftclick': "down" };
                producer.send(JSON.stringify(data));
                //console.log("mousedown: " + JSON.stringify(event));
            }, false);
            this.canvas2.addEventListener('mouseup', () => {
                const data = { 'leftclick': "up" };
                producer.send(JSON.stringify(data));
                //console.log("mouseup: " + JSON.stringify(event));
            }, false);
            this.canvas2.addEventListener('mousemove', (event) => {
                let pos = this.getPos(event);
                const data = { "move": { "x": pos.x, "y": pos.y } };
                producer.send(JSON.stringify(data));
                //console.log("mousemove : x=" + pos.x + ", y=" + pos.y);
            }, false);

            this.canvas2.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                const data = { "rightclick": true };
                producer.send(JSON.stringify(data));
                //console.log(JSON.stringify(event));
            }, false);

            this.canvas2.addEventListener('keydown', (event) => {
                event.preventDefault();
                const keyevent = this.keyborad(event, 'down');
                if (keyevent.key != null && keyevent.updown) {
                    const data = { "key": keyevent };
                    producer.send(JSON.stringify(data));
                }
                //console.log("keycode down: " + event.key + ' shift:' + event.shiftKey + ' ctrl:' + event.ctrlKey + ' ' + event.keyCode + ' ' + String.fromCharCode(event.keyCode));
            }, false);
            this.canvas2.addEventListener('keyup', (event) => {
                event.preventDefault();
                let keyevent = this.keyborad(event, 'up');
                if (keyevent.key != null && keyevent.updown) {
                    const data = { "key": keyevent };
                    producer.send(JSON.stringify(data));
                }
                //console.log("keycode up: " + event.key + ' shift:' + event.shiftKey + ' ctrl:' + event.ctrlKey + ' ' + event.keyCode + ' ' + String.fromCharCode(event.keyCode));
            }, false);

            this.canvas2.addEventListener('wheel', (event) => {
                event.preventDefault();
                const data = { "wheel": event.deltaY / 100 };
                producer.send(JSON.stringify(data));
                //console.log("scroll: "+JSON.stringify(data.wheel));
            }, false);

        });
    }


    // --- Cousumer ---

    async createRecvScreenTransport() {
        const params = await this.sendRequest('createConsumerTransport', { 
            'type': 'screen', 
            'desktopAddress': this.desktopAddress
        });
        const transport = this.msDevice.createRecvTransport(params);

        transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            this.sendRequest('connectConsumerTransport', {
                transportId: transport.id,
                dtlsParameters: dtlsParameters,
            }).then(callback)
                .catch(errback);
        });

        transport.observer.on('close', () => {
            transport.close();
        });

        this.msRecvScreenTransport = transport;
    }

    async getScreen() {
        const params = await this.sendRequest('consumeScreen', { 
            transportId: this.msRecvScreenTransport.id, 
            desktopAddress: this.desktopAddress 
        });
        const consumer = await this.msRecvScreenTransport.consumeData(params);

        consumer.on('message', buf => {
            const imgBase64 = btoa(new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), ''));
            this.image.src = 'data:image/jpeg;base64,' + imgBase64;
        });
    }

    // --- utils ---
    getPos(event) {
    const mouseX = event.clientX - this.canvas2.getBoundingClientRect().left;
    const mouseY = event.clientY - this.canvas2.getBoundingClientRect().top;
    return { x: mouseX, y: mouseY };
    };

    keyborad(msg, updown) {
        let keydata = {};
        let mod = [];

        if (msg.shiftKey) {
            mod[mod.length] = 'LeftShift';
        }
        if (msg.ctrlKey) {
            mod[mod.length] = 'LeftControl';
        }
        if (msg.altKey) {
            mod[mod.length] = 'LeftAlt';
        }

        if (msg.key.length == 1 && msg.key.match(/[a-z]/i)) {
            keydata = { key: msg.key.toUpperCase(), updown: updown, mod: mod };
            //console.log("key: "+ msg.key.toUpperCase());
        }
        else if (msg.key.length == 1 && msg.key.match(/[0-9]/)) { //0~9
            keydata = { key: "Num" + msg.key.match(/[0-9]/), updown: updown, mod: mod };
            //console.log("Num: " + JSON.stringify(msg.key));
        }
        //else if (msg.key.length == 1 && (String.fromCharCode(msg.keyCode)).match(/[0-9]/)) { //1~9    
        //    console.log("Shift Num: " + JSON.stringify(msg.key));
        //    keydata = { key: "Num" + (String.fromCharCode(msg.keyCode)).match(/[0-9]/), updown: updown, mod: mod };
        //} 
        else if (msg.key.match(/^F[1-9]*/)) { //F1~9
            keydata = { key: msg.key, updown: updown, mod: mod };
            //console.log("F: "+JSON.stringify(msg.key));
        } else if (msg.key == 'Control') {
            keydata = { key: undefined, updown: updown, mod: mod };
        } else if (msg.key == 'Alt') {
            keydata = { key: undefined, updown: updown, mod: mod };
        } else if (msg.key == 'Shift') {
            keydata = { key: undefined, updown: updown, mod: mod };
        } else if (msg.key == 'Escape') {
            keydata = { key: 'Escape', updown: updown, mod: mod };
        } else if (msg.key == 'Enter') {
            keydata = { key: 'Enter', updown: updown, mod: mod };
        } else if (msg.key == 'Backspace') {
            keydata = { key: 'Backspace', updown: updown, mod: mod };
        } else if (msg.key == 'Tab') {
            keydata = { key: 'Tab', updown: updown, mod: mod };
        } else if (msg.key == 'Home') {
            keydata = { key: 'Home', updown: updown, mod: mod };
        } else if (msg.key == 'End') {
            keydata = { key: 'End', updown: updown, mod: mod };
        } else if (msg.key == 'PageUp') {
            keydata = { key: 'Pageup', updown: updown, mod: mod };
        } else if (msg.key == 'PageDown') {
            keydata = { key: 'Pagedown', updown: updown, mod: mod };
        } else if (msg.key == 'ArrowRight') {
            keydata = { key: 'Right', updown: updown, mod: mod };
        } else if (msg.key == 'ArrowLeft') {
            keydata = { key: 'Left', updown: updown, mod: mod };
        } else if (msg.key == 'ArrowUp') {
            keydata = { key: 'Up', updown: updown, mod: mod };
        } else if (msg.key == 'ArrowDown') {
            keydata = { key: 'Down', updown: updown, mod: mod };
        } else if (msg.key == 'Insert') {
            keydata = { key: 'Insert', updown: updown, mod: mod };
        } else if (msg.key == 'Delete') {
            keydata = { key: 'Delete', updown: updown, mod: mod };
        } else if (msg.key == ' ') {
            keydata = { key: 'Space', updown: updown, mod: mod };
        } else if (msg.key == 'Alphanumeric shift') {
            keydata = { key: 'CapsLock', updown: updown, mod: mod };
        } else if (msg.key == '[' || msg.keyCode == 219) {
            keydata = { key: 'LeftBracket', updown: updown, mod: mod };
        } else if (msg.key == ']' || msg.keyCode == 221) {
            keydata = { key: 'RightBracket', updown: updown, mod: mod };
        } else if (msg.key == '-') {
            keydata = { key: 'Minus', updown: updown, mod: mod };
        } else if (msg.key == ',' || msg.keyCode == 188) {
            keydata = { key: 'Comma', updown: updown, mod: mod };
        } else if (msg.key == '.' || msg.keyCode == 190) {
            keydata = { key: 'Period', updown: updown, mod: mod };
        }
        ////////////////////////
        else if (msg.key == '/' || msg.keyCode == 191) {
            keydata = { key: 'Slash', updown: updown, mod: mod };
        } else if (msg.key == '\\' || msg.keyCode == 220) {
            keydata = { key: 'Backslash', updown: updown, mod: mod };
        } else if (msg.key == '+') {
            keydata = { key: 'Add', updown: updown, mod: [] };
        } else if (msg.key == '_') {
            keydata = { key: 'Minus', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '=') {
            keydata = { key: 'Equal', updown: updown, mod: [] };
        } else if (msg.key == ':') {
            keydata = { key: 'Semicolon', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '\"') {
            keydata = { key: 'Quote', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '`') {
            keydata = { key: 'Grave', updown: updown, mod: [] };
        } else if (msg.key == '~') {
            keydata = { key: 'Grave', updown: updown, mod: ['LeftShift'] };
        }
        ///////////////////// --- Shift + 0~9 
        else if (msg.key == '!') {
            keydata = { key: 'Num1', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '@') {
            keydata = { key: 'Num2', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '#') {
            keydata = { key: 'Num3', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '$') {
            keydata = { key: 'Num4', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '%') {
            keydata = { key: 'Num5', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '^') {
            keydata = { key: 'Num6', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '&') {
            keydata = { key: 'Num7', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '*') {
            keydata = { key: 'Num8', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == '(') {
            keydata = { key: 'Num9', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key == ')') {
            keydata = { key: 'Num0', updown: updown, mod: ['LeftShift'] };
        } else if (msg.key.length == 1) {
            keydata = { key: msg.key, updown: updown, mod: [], symbol: true };
        }

        mod = [];
        //console.log(JSON.stringify(keydata));
        return keydata;
    }

    // --- common use ---

    sendRequest(type, data) {
        return new Promise((resolve, reject) => {
            this.sock.emit(type, data, res => resolve(res));
        });
    }
}
