export type Media = { blob:Blob; name:string; duration?:number; width?:number; height?:number; fps?:number };
function connect() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const r=indexedDB.open('cinecontrol-studio-media',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('files');
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
export async function writeMedia(key:string, value:Media|null){
  const db=await connect();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('files','readwrite');
      if(value)tx.objectStore('files').put(value,key); else tx.objectStore('files').delete(key);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  } finally {db.close();}
}
export async function readMedia(key:string) {
  const db=await connect();
  try {
    return await new Promise<Media|undefined>((resolve,reject)=>{
      const r=db.transaction('files').objectStore('files').get(key);
      r.onsuccess=()=>resolve(r.result as Media|undefined);r.onerror=()=>reject(r.error);
    });
  } finally {db.close();}
}

export function download(name:string,data:Blob|string|Uint8Array|ArrayBuffer){
  const blob=data instanceof Blob?data:new Blob([data instanceof Uint8Array?new Uint8Array(data):data]);
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
export const json = (value:unknown) => JSON.stringify(value,null,2);

export async function readPrefix(prefix:string){
  const db=await connect();
  try{
    return await new Promise<[string,Media][]>((resolve,reject)=>{
      const values:[string,Media][]=[];
      const cursor=db.transaction('files').objectStore('files').openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
      cursor.onsuccess=()=>{
        const item=cursor.result;
        if(!item){resolve(values);return;}
        values.push([String(item.key),item.value as Media]);item.continue();
      };
      cursor.onerror=()=>reject(cursor.error);
    });
  }finally{db.close();}
}
export async function writeCollection(entries:[string,Media][]){
  const db=await connect();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('files','readwrite'),store=tx.objectStore('files');
      for(const [key,value] of entries)store.put(value,key);
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??Error('Unable to save the imported media.'));tx.onerror=()=>reject(tx.error);
    });
  }finally{db.close();}
}
