// Calibrated against the shipped, normalized meshes (metres, forward -Z).
// These are game seating/cluster fits, not manufacturer CAD measurements.
export const COCKPIT_PROFILES=Object.freeze({
 concept:{eye:[0,1.055,-.08],hfov:94,steering:207,cluster:[0,.812,-1.099],normal:[0,.339,.941],width:.34,height:.105,style:'digital',accent:'#9bddeb'},
 roadster:{eye:[-.348,1.015,.30],hfov:90,steering:207,cluster:[-.348,.815,-.83],normal:[0,.12,.993],width:.30,height:.10,style:'electric',accent:'#e8f0f4'},
 bmw:{eye:[-.327,1.12,.25],hfov:88,steering:360,cluster:[-.327,.93,-.78],normal:[0,.10,.995],width:.38,height:.13,style:'analog',accent:'#e6a35f',dials:[[-.14,-.015,.032,'FUEL',1],[-.066,0,.056,'KM/H',240],[.066,0,.056,'RPM',8],[.14,-.015,.032,'TEMP',120]]},
 nsx:{eye:[-.333,1.04,.32],pitch:.065,hfov:86,steering:360,cluster:[-.333,.82,-.70],normal:[0,.15,.989],width:.36,height:.13,style:'analog',accent:'#e4e9df',dials:[[-.13,-.012,.028,'FUEL',1],[-.06,0,.054,'RPM',8],[.06,0,.054,'KM/H',280],[.13,-.012,.028,'TEMP',120]]},
 porsche:{eye:[-.314,1.10,.48],pitch:.035,hfov:84,steering:360,cluster:[-.30,.925,-.665],normal:[0,.10,.995],width:.46,height:.13,style:'analog',accent:'#e9e4d2',dials:[[-.18,-.014,.033,'FUEL',1],[-.10,-.005,.042,'TEMP',120],[0,0,.058,'RPM',8],[.10,-.005,.042,'KM/H',260],[.18,-.014,.033,'OIL',5]]},
});
export function cockpitFov(profile,aspect){
 const safe=Number.isFinite(aspect)&&aspect>0?aspect:16/9;
 // Horizontal FOV reference on landscape; bound vertical FOV on tall phones.
 return Math.max(48,Math.min(74,2*Math.atan(Math.tan(profile.hfov*Math.PI/360)/safe)*180/Math.PI));
}
