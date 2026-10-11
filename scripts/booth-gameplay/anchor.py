"""Original silent window. Run only with pythonw on an owned inactive Booth."""
import argparse,ctypes,json,os,time,tkinter as tk
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--receipt',required=True);p.add_argument('--minutes',required=True,type=int);a=p.parse_args()
if not 1<=a.minutes<=60 or not Path(a.receipt).is_absolute():raise SystemExit(2)
window=tk.Tk();window.title('Nostalgia silent gameplay anchor');window.geometry('320x240+0+0');window.configure(background='#182028')
tk.Label(window,text='Nostalgia gameplay workspace',fg='white',bg='#182028').pack(pady=40)
window.update_idletasks();window.update()
with Path(a.receipt).open('x') as f:json.dump({'pid':os.getpid(),'hwnd':int(window.winfo_id()),'silent_original_anchor':True},f)
window.after(a.minutes*60000,window.destroy);window.mainloop()
