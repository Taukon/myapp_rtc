cmd_Release/obj.target/screenshot.node := g++ -o Release/obj.target/screenshot.node -shared -pthread -rdynamic -m64  -Wl,-soname=screenshot.node -Wl,--start-group Release/obj.target/screenshot/screenshot.o -Wl,--end-group -lX11 -ljpeg