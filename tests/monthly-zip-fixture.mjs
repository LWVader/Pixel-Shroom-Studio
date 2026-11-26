export function sampleZip(count=10,{folder=false,size=0}={}){
  const local=[], directory=[];let offset=0;
  const data=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=","base64");
  const files=Array.from({length:count},(_,i)=>[folder?`Monthly backgrounds/image-gen-${i+1}(1).png`:`image-${i}.png`,size?Buffer.alloc(size,i+1):data]);
  if(folder)files.unshift(["Monthly backgrounds/",Buffer.alloc(0)]);
  for(const [filename,entry] of files){
    const name=Buffer.from(filename);
    const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);
    h.writeUInt32LE(entry.length,18);h.writeUInt32LE(entry.length,22);h.writeUInt16LE(name.length,26);
    local.push(h,name,entry);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
    c.writeUInt32LE(entry.length,20);c.writeUInt32LE(entry.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    directory.push(c,name);offset+=h.length+name.length+entry.length;
  }
  const central=Buffer.concat(directory), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,central,end]);
}
