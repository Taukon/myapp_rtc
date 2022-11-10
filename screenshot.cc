#include <napi.h>

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <iostream>
#include <stdlib.h>
#include <jpeglib.h>


char *getJpegImg(size_t *mem_size, Display *display)
{
    Window root;
    XImage *img;

    root = DefaultRootWindow(display);

    img = XGetImage(display, root, 0, 0, XDisplayWidth(display, 0), XDisplayHeight(display, 0), AllPlanes, ZPixmap);

    char *mem = NULL;

    int x, y;
    char *buffer;
    struct jpeg_compress_struct cinfo;
    struct jpeg_error_mgr jerr;
    JSAMPROW row_pointer;
    int bpp = 4;

    buffer = (char *)malloc(sizeof(char) * 3 * img->width * img->height);
    for (y = 0; y < img->height; y++)
    {
        for (x = 0; x < img->width; x++)
        {
            buffer[(y * img->width + x) * 3 + 0] = img->data[(y * img->width + x) * bpp + 2] & 0xff;
            buffer[(y * img->width + x) * 3 + 1] = img->data[(y * img->width + x) * bpp + 1] & 0xff;
            buffer[(y * img->width + x) * 3 + 2] = img->data[(y * img->width + x) * bpp + 0] & 0xff;
        }
    }

    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_compress(&cinfo);

    jpeg_mem_dest(&cinfo, (unsigned char **)&mem, mem_size);

    cinfo.image_width = img->width;
    cinfo.image_height = img->height;
    cinfo.input_components = 3;
    cinfo.in_color_space = JCS_RGB;

    jpeg_set_defaults(&cinfo);
    jpeg_set_quality(&cinfo, 85, TRUE);
    jpeg_start_compress(&cinfo, TRUE);

    while (cinfo.next_scanline < cinfo.image_height)
    {
        row_pointer = (JSAMPROW)&buffer[cinfo.next_scanline * (img->depth >> 3) * img->width];
        jpeg_write_scanlines(&cinfo, &row_pointer, 1);
    }
    free(buffer);
    buffer = NULL;
    jpeg_finish_compress(&cinfo);

    free(img->data);
    img->data = NULL;
    XDestroyImage(img);

    return mem;
}

void cleanup(Napi::Env env, void *arg)
{
    free(arg);
}

Display *display = NULL;

Napi::Value Method(const Napi::CallbackInfo &info)
{
    Napi::Env env = info.Env();

    if (display == NULL)
    {
        display = XOpenDisplay(NULL);
    }
    size_t msize;
    char *img = getJpegImg(&msize, display);
    
    return Napi::Buffer<char>::New(env, img, msize, cleanup);
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set(Napi::String::New(env, "screenshot"),
                Napi::Function::New(env, Method));
    return exports;
}

NODE_API_MODULE(screenshot, Init)