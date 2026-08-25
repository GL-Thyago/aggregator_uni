import re
import requests
import numpy
import os
from threading import Thread


files = ['data.json', 'payout.html', 'opus.wasm.js', 'opus.wasm.wasm', 'scripts/c3runtime.js', 'offline.json', 'sw.js', 'scripts/jobworker.js', 'scripts/dispatchworker.js', 'mg.json', 'mg.atlas',
         'mg.png', 'mg_2.png']
print(files)
for file in files:
    url = "https://testing.tegahub.com/uploads/games/Bikini_Paradise-599213/" + file
    print("Downloading " + url)

    if not os.path.exists(""+file):
        
        r = requests.get(url, allow_redirects=False)
        open(file, 'wb').write(r.content)
    else:
        print("Exists")