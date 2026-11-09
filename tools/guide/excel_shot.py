# Renders the Sales Desk Excel export (.quote.xlsx, saved by shots-2) to the guide
# image 17b-excel.png. Needs LibreOffice (soffice) and pdftoppm.
import os, subprocess, tempfile, shutil
from PIL import Image
here=os.path.dirname(os.path.abspath(__file__))
src=os.path.join(here,'.quote.xlsx')
out=os.path.join(here,'..','..','web','guide','img','17b-excel.png')
tmp=tempfile.mkdtemp()
try:
    subprocess.run(['soffice','--headless','--convert-to','pdf','--outdir',tmp,src],check=True,capture_output=True,timeout=180)
    pdf=os.path.join(tmp,'.quote.pdf')
    subprocess.run(['pdftoppm','-png','-r','110','-f','1','-l','1',pdf,os.path.join(tmp,'p')],check=True)
    png=[f for f in os.listdir(tmp) if f.startswith('p') and f.endswith('.png')][0]
    im=Image.open(os.path.join(tmp,png)).convert('RGB')
    # trim the white page margin
    bg=Image.new('RGB',im.size,(255,255,255))
    from PIL import ImageChops
    box=ImageChops.difference(im,bg).getbbox()
    if box: im=im.crop((max(0,box[0]-12),max(0,box[1]-12),min(im.width,box[2]+12),min(im.height,box[3]+12)))
    im.save(out); print('wrote',out,im.size)
finally:
    shutil.rmtree(tmp,ignore_errors=True)
