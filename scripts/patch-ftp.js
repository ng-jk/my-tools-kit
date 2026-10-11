'use strict';
// Narrow build-time repair of ftp@0.3.10. Fail closed if upstream anchors change.
function patchFtp(source) {
  source=source.replace(/\r\n/g,'\n');
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw new Error('FTP security patch no longer matches the locked dependency');
    source=source.replace(before,after);
  };
  replace("  if (this.options.secure === 'implicit')\n    this._socket = tls.connect(secureOptions, onconnect);\n  else {",`  if (this.options.secure === 'implicit') {
    delete secureOptions.socket;
    secureOptions.port = this.options.port;
    socket = tls.connect(secureOptions, onconnect);
    this._socket = socket;
  } else {`);
  replace('self._socket = socket; // re-assign for implicit secure connections','self._socket = socket; // retain the active TLS transport');
  replace("        if (self.options.secure && self.options.secure !== 'implicit') {",`        if (self.options.secure === 'implicit') {
          cmd = 'PBSZ';
          self._send('PBSZ 0', reentry, true);
        } else if (self.options.secure) {`);
  replace('  this._socket.connect(this.options.port, this.options.host);',"  if (this.options.secure !== 'implicit') this._socket.connect(this.options.port, this.options.host);");
  const start=source.indexOf('FTP.prototype._pasvConnect = function('),end=source.indexOf('FTP.prototype._store = function(',start);
  if(start<0||end<0)throw new Error('FTP passive TLS patch anchor missing');
  source=source.slice(0,start)+`FTP.prototype._pasvConnect = function(ip, port, cb) {
  var self=this, settled=false;
  var secure=self.options.secure===true || self.options.secure==='implicit';
  var options=Object.assign({},self.options.secureOptions || {},{host:ip,port:port});
  delete options.socket;
  if(secure) {
    options.session=self._socket.getSession();
    // Verify the configured control host, not an address supplied by PASV.
    var identity=options.servername || self.options.host;
    options.checkServerIdentity=function(_,cert){return tls.checkServerIdentity(identity,cert);};
    if(!require('net').isIP(identity))options.servername=identity;
    else delete options.servername;
  }
  var socket=secure ? tls.connect(options) : new Socket();
  var timer=setTimeout(function(){finish(new Error('Timed out while making data connection'));},self.options.pasvTimeout);
  function finish(err) {
    if(settled)return;
    settled=true;clearTimeout(timer);
    if(err){socket.destroy();cb(err);return;}
    self._pasvSocket=socket;cb(undefined,socket);
  }
  socket.once(secure?'secureConnect':'connect',function(){finish();});
  socket.on('error',function(err){if(!settled)finish(err);});
  socket.once('close',function(){
    if(!settled)finish(new Error('Data connection closed before it was ready'));
    if(self._pasvSocket===socket)self._pasvSocket=undefined;
  });
  if(!secure)socket.connect(port,ip);
};

`+source.slice(end);
  return source;
}
module.exports={patchFtp};
