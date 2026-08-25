import re
import requests
import numpy
import os
from threading import Thread


files = ['icons/loading-logo.png','icons/icon-64.png','icons/icon-16.png','icons/icon-32.png','11.png','23.png','1.png','2.png','3.png','22.png','avatar.png','avatar_4.png','avatar_3.png','avatar_2.png','4.png','24.png','21.png','13.png','12.png','avatar.json','history-list.html','history-detail.html','avatar.atlas','BetSelect.json','BetOption.json', 'gamerule.html','data.json', 'payout.html', 'scripts/opus.wasm.js', 'scripts/opus.wasm.wasm', 'scripts/c3runtime.js', 'offline.json', 'sw.js', 'scripts/jobworker.js', 'scripts/dispatchworker.js', 'mg.json', 'mg.atlas',
         'mg.png', 'mg_2.png', 'gamerule.txt', 'payout.txt', 'history.txt', 'betdata.json']
# files = '''39.png
# 40.png
# 50.png
# 66.png
# 10.png
# 15.png
# 32.png
# 59.png
# f5b3d071-cc2a-43fd-9158-838299c0637b.png'''.splitlines()
print(files)
for file in files:
    url = "https://testing.slotgen.com/uploads/games/fortune_rabbit_slotgen_11-557580/" + file
    print("Downloading " + url)

    if (not os.path.exists(""+file)):
        
        r = requests.get(url, allow_redirects=False)
        open(file, 'wb').write(r.content)
    else:
        print("Exists")