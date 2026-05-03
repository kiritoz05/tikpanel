const SERVER_URL = "https://mipanel-tiktok-production.up.railway.app";

const sv=(k,v)=>localStorage.setItem("tp_"+k,JSON.stringify(v));
const ld=(k,d)=>{try{return JSON.parse(localStorage.getItem("tp_"+k))??d}catch{return d}}

function speak(text){
const u=new SpeechSynthesisUtterance(text);
speechSynthesis.speak(u);
}

function App(){

const [user,setUser]=React.useState(()=>ld("user",null));
const [tiktokUser,setTiktokUser]=React.useState(()=>ld("tuser",""));
const [connected,setConnected]=React.useState(()=>ld("connected",false));
const [gifts,setGifts]=React.useState(()=>ld("gifts",[]));
const [actions,setActions]=React.useState(()=>ld("actions",[]));
const [ranking,setRanking]=React.useState({});

React.useEffect(()=>sv("user",user),[user]);
React.useEffect(()=>sv("tuser",tiktokUser),[tiktokUser]);
React.useEffect(()=>sv("connected",connected),[connected]);
React.useEffect(()=>sv("gifts",gifts),[gifts]);
React.useEffect(()=>sv("actions",actions),[actions]);

React.useEffect(()=>{
const socket=io(SERVER_URL);

socket.on("event",(d)=>{

  if(d.type==="gift"){

    setGifts(prev=>{
      if(prev.find(g=>g.name===d.giftName)) return prev;
      return [...prev,{name:d.giftName,image:d.giftPictureUrl}]
    });

    setRanking(prev=>{
      const copy={...prev};
      copy[d.nickname]=(copy[d.nickname]||0)+(d.diamondCount||0);
      return copy;
    });

    fireAction("gift",d);
  }

  if(d.type==="follow"){
    fireAction("follow",d);
  }

});

},[]);

async function connect(){
await fetch(SERVER_URL+"/connect",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({username:tiktokUser})
});
setConnected(true);
}

function fireAction(type,data){
actions.forEach(a=>{
if(a.type!==type) return;
if(type==="gift" && a.gift && a.gift!==data.giftName) return;

  if(a.sound){
    new Audio(a.sound).play();
  }

  if(a.tts){
    speak(a.tts.replace("@user",data.nickname));
  }
});

}

function uploadSound(e,i){
const reader=new FileReader();
reader.onload=()=>{
const copy=[...actions];
copy[i].sound=reader.result;
setActions(copy);
};
reader.readAsDataURL(e.target.files[0]);
}

if(!user){
return (
<div className="container">
<h2>Entrar</h2>
<button onClick={()=>setUser({plan:"pro"})}>Entrar</button>
</div>
);
}

return (
<div className="container">

  <div className="card">
    <h3>Conectar</h3>
    <input value={tiktokUser} onChange={e=>setTiktokUser(e.target.value)} placeholder="usuario"/>
    <button onClick={connect}>
      {connected ? "Conectado ✅" : "Conectar"}
    </button>
  </div>

  <div className="card">
    <h3>Regalos</h3>
    <div className="gifts">
      {gifts.map(g=>(
        <div key={g.name} className="gift">
          <img src={g.image}/>
          {g.name}
        </div>
      ))}
    </div>
  </div>

  <div className="card">
    <h3>Acciones</h3>

    <button onClick={()=>setActions([...actions,{type:"gift"}])}>
      + Acción
    </button>

    {actions.map((a,i)=>(
      <div key={i}>

        <select onChange={e=>{
          const copy=[...actions];
          copy[i].gift=e.target.value;
          setActions(copy);
        }}>
          <option value="">Todos</option>
          {gifts.map(g=><option key={g.name}>{g.name}</option>)}
        </select>

        <input type="file" onChange={e=>uploadSound(e,i)}/>
        <input placeholder="Mensaje TTS"
          onChange={e=>{
            const copy=[...actions];
            copy[i].tts=e.target.value;
            setActions(copy);
          }}
        />

      </div>
    ))}

  </div>

  <div className="card">
    <h3>Top</h3>
    {Object.entries(ranking)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,5)
      .map(([u,p])=>(
        <div key={u} className="rank">{u} - {p}</div>
      ))}
  </div>

</div>

);
}

ReactDOM.render(<App/>,document.getElementById("root"));
