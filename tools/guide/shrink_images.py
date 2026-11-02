import json,os,glob
from PIL import Image
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','web','guide'))
for f in glob.glob('img/*.png'):
    im=Image.open(f)
    if im.mode=='P': continue
    im.convert('RGB').quantize(colors=256,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE).save(f,optimize=True)
print(sum(os.path.getsize(f) for f in glob.glob('img/*.png'))//1024,'KB')
