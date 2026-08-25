import re
import requests
import os
import json
data = open("data.json").read()
json_ = json.loads(data)['project'][7]
for l in json_:
    file = "media/"+l[0]+".webm"
    url = "https://testing.tegahub.com/uploads/games/Bikini_Paradise-599213/" + file
    print("Downloading " + url)
    if not os.path.exists(file):
        r = requests.get(url, allow_redirects=False)
        open(file, 'wb').write(r.content)
print("Ok")