"""Local preview with automatic rebuilds: python3 scripts/serve.py."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading
from watch import ROOT, build, snapshot


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    build()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),partial(SimpleHTTPRequestHandler,directory=str(ROOT/'dist')))
    stopped=threading.Event()
    def watch():
        previous=snapshot()
        while not stopped.wait(.75):
            current=snapshot()
            if current!=previous:
                build()
                previous=snapshot()
    thread=threading.Thread(target=watch,daemon=True);thread.start()
    print(f'Preview: http://127.0.0.1:{args.port}/ — watching Markdown and site files. Refresh after edits.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:stopped.set();server.server_close();thread.join(timeout=2)


if __name__=='__main__':main()
