import re
import requests
import numpy
import os
from threading import Thread


#def save(file, content):

data = open(r"data.json").read()
pattern = '(images/.*?)"'
files = re.findall(pattern, data)
files = numpy.array(files)
 
for file in files:
    url = "https://testing.slotgen.com/uploads/games/fortune_rabbit_slotgen_11-557580/" + file
    print("Downloading " + url)

    if not os.path.exists(file)  :
        r = requests.get(url, allow_redirects=False)
        open(file, 'wb').write(r.content)
    else:
        print("Exists")

