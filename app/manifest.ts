import type {MetadataRoute} from 'next';
// STU-16: installable from the phone browser. It opens on the practice home, the screen students use most.
export default function manifest():MetadataRoute.Manifest {
 return {name:'Recalls Tutor',short_name:'Recalls Tutor',description:'Practise exam recall questions, reviewed by our team.',start_url:'/practice',scope:'/',display:'standalone',orientation:'portrait',background_color:'#f8fafc',theme_color:'#0f766e',
  icons:[{src:'/icons/192',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icons/512',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icons/512',sizes:'512x512',type:'image/png',purpose:'maskable'}]};
}
