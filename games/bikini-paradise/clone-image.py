import re
import requests
import numpy
import os
from threading import Thread



data = open(r"data.json").read()
pattern = '(images/.*?)"'
files = re.findall(pattern, data)
files = numpy.array(files)

for file in files:
    url = "https://testing.tegahub.com/uploads/games/Bikini_Paradise-599213/" + file
    print("Downloading " + url + "...", end='')

    if not os.path.exists(""+file):
        r = requests.get(url, allow_redirects=False)
        open(file, 'wb').write(r.content)
        print("Ok")
    else:
        print("Exists")