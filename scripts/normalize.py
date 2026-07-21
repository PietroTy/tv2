import json
import os
import sys

data_path_json = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'channels.json')
data_path_js = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'channels.js')

with open(data_path_json, 'r', encoding='utf-8') as f:
    channels = json.load(f)

for i, ch in enumerate(channels):
    name = ch.get('name', f'CANAL{i+1}')
    clean_name = name.split('·')[-1].strip().upper()
    
    if i == 0: clean_name = "DIABO NESCESSÁRIO"
    elif i == 1: clean_name = "BOGAROSA GAMES"
    elif i == 2: clean_name = "FUDÊNCIO"
    elif i == 7: clean_name = "FUDÊNCIO II"
    
    label = f"CH {i+1:02d} · {clean_name}"
    
    ch['name'] = clean_name
    ch['label'] = label

with open(data_path_json, 'w', encoding='utf-8') as f:
    json.dump(channels, f, ensure_ascii=False, indent=2)

print("JSON normalizado!")
