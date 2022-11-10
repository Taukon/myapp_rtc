#include <napi.h>

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <iostream>
#include <stdlib.h>


char *getImg(size_t *mem_size)
{
    Display *display;
    Window root;
    XImage *img;

    display = XOpenDisplay(NULL);
    root = DefaultRootWindow(display);
    
    img = XGetImage(display, root, 0, 0, XDisplayWidth(display, 0), XDisplayHeight(display, 0), AllPlanes, ZPixmap);


    int bpp = (int)img->bits_per_pixel / 8; //4

    char *buffer = (char *)malloc(sizeof(char) * bpp * img->width * img->height);

    *mem_size = sizeof(char) * bpp * img->width * img->height;

    memcpy(buffer, img->data, bpp * img->width * img->height);

    free(img->data);
    img->data = NULL;
    XDestroyImage(img);
    XCloseDisplay(display);

    return buffer;
}

void cleanup(Napi::Env env, void *arg)
{
    free(arg);
}

Napi::Value screenshot(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    size_t msize;
    char *img = getImg(&msize);

    return Napi::Buffer<char>::New(env, img, msize, cleanup);
}


Napi::Value getWidth(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    Display *display;
    Window root;
    XImage *img;

    display = XOpenDisplay(NULL);
    root = DefaultRootWindow(display);

    img = XGetImage(display, root, 0, 0, XDisplayWidth(display, 0), XDisplayHeight(display, 0), AllPlanes, ZPixmap);

    Napi::Number width = Napi::Number::New(env, img->width);

    free(img->data);
    img->data = NULL;
    XDestroyImage(img);
    XCloseDisplay(display);

    return width;
}

Napi::Value getHeight(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    Display *display;
    Window root;
    XImage *img;

    display = XOpenDisplay(NULL);
    root = DefaultRootWindow(display);

    img = XGetImage(display, root, 0, 0, XDisplayWidth(display, 0), XDisplayHeight(display, 0), AllPlanes, ZPixmap);

    Napi::Number height = Napi::Number::New(env, img->height);

    free(img->data);
    img->data = NULL;
    XDestroyImage(img);
    XCloseDisplay(display);

    return height;
    ;
}

Napi::Value getDepth(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    Display *display;
    Window root;
    XImage *img;

    display = XOpenDisplay(NULL);
    root = DefaultRootWindow(display);

    img = XGetImage(display, root, 0, 0, XDisplayWidth(display, 0), XDisplayHeight(display, 0), AllPlanes, ZPixmap);

    Napi::Number depth = Napi::Number::New(env, img->depth);

    free(img->data);
    img->data = NULL;
    XDestroyImage(img);
    XCloseDisplay(display);

    return depth;
}

Napi::Value getFb_bpp(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    Display *display;
    Window root;
    XImage *img;

    display = XOpenDisplay(NULL);
    root = DefaultRootWindow(display);

    img = XGetImage(display, root, 0, 0, XDisplayWidth(display, 0), XDisplayHeight(display, 0), AllPlanes, ZPixmap);

    Napi::Number fb_bpp = Napi::Number::New(env, img->bits_per_pixel);

    free(img->data);
    img->data = NULL;
    XDestroyImage(img);
    XCloseDisplay(display);

    return fb_bpp;
}


Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set(Napi::String::New(env, "screenshot"),
                Napi::Function::New(env, screenshot));
    exports.Set(Napi::String::New(env, "getWidth"),
                Napi::Function::New(env, getWidth));
    exports.Set(Napi::String::New(env, "getHeight"),
                Napi::Function::New(env, getHeight));
    exports.Set(Napi::String::New(env, "getDepth"),
                Napi::Function::New(env, getDepth));
    exports.Set(Napi::String::New(env, "getFb_bpp"),
                Napi::Function::New(env, getFb_bpp));
    return exports;
}

NODE_API_MODULE(screenshot, Init);