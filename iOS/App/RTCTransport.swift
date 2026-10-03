import WebKit
import SwiftUI

/// WebKit supplies the system WebRTC data channel only; all visible UI and
/// chess rules remain native. Credentials and HTTP requests never enter JS.
@MainActor
final class RTCTransport: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    var receive: (([String: Any]) -> Void)?
    private var ready = false
    private var commands: [[String: Any]] = []

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "peer")
        webView.navigationDelegate = self
        webView.isUserInteractionEnabled = false
        webView.loadHTMLString(Self.html, baseURL: URL(string: "https://141.148.168.171"))
    }
    func command(_ value: [String: Any]) {
        guard ready else { commands.append(value); return }
        guard let data = try? JSONSerialization.data(withJSONObject: value), let encoded = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.peerCommand(\(encoded))") { [weak self] _, error in
            if let error { self?.receive?(["type": "error", "message": error.localizedDescription]) }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let value = message.body as? [String: Any] else { return }
        if value["type"] as? String == "ready" {
            ready = true; let waiting = commands; commands = []; waiting.forEach(command)
        }
        receive?(value)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false; commands = []
        receive?(["type": "closed"])
        webView.loadHTMLString(Self.html, baseURL: URL(string: "https://141.148.168.171"))
    }
    private static let html = #"""
    <!doctype html><meta name="viewport" content="width=device-width"><script>
    let pc=null,dc=null,pending=[],chain=Promise.resolve();
    const emit=value=>window.webkit.messageHandlers.peer.postMessage(value);
    function close(){
      if(dc){dc.onclose=null;dc.onopen=null;dc.onmessage=null;dc.close();}
      if(pc){pc.onconnectionstatechange=null;pc.onicecandidate=null;pc.close();}
      pc=null;dc=null;pending=[];
    }
    function bind(channel){
      dc=channel;
      channel.onopen=()=>emit({type:'open'});
      channel.onclose=()=>emit({type:'closed'});
      channel.onmessage=e=>{
        try{if(typeof e.data!=='string'||e.data.length>8192)throw Error('无效对局消息');emit({type:'data',value:JSON.parse(e.data)});}
        catch(error){emit({type:'error',message:error.message});}
      };
    }
    async function command(m){
      if(m.type==='close'){close();return;}
      if(m.type==='connect'){
        close();pc=new RTCPeerConnection({iceServers:m.iceServers});
        pc.onicecandidate=e=>{if(e.candidate)emit({type:'signal',kind:'candidate',payload:e.candidate.toJSON()});};
        pc.ondatachannel=e=>bind(e.channel);
        pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState))emit({type:'closed'});};
        if(m.initiator){bind(pc.createDataChannel('yisi-xiangqi',{ordered:true}));await pc.setLocalDescription(await pc.createOffer());emit({type:'signal',kind:'offer',payload:pc.localDescription.toJSON()});}
      }else if(m.type==='signal'){
        if(!pc)throw Error('连接未初始化');
        if(m.kind==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(m.payload);else pending.push(m.payload);}
        else {await pc.setRemoteDescription(m.payload);for(const c of pending.splice(0))await pc.addIceCandidate(c);
          if(m.kind==='offer'){await pc.setLocalDescription(await pc.createAnswer());emit({type:'signal',kind:'answer',payload:pc.localDescription.toJSON()});}}
      }else if(m.type==='send'){
        if(!dc||dc.readyState!=='open')throw Error('对局连接已断开');dc.send(JSON.stringify(m.value));
      }
    }
    window.peerCommand=m=>{chain=chain.then(()=>command(m)).catch(error=>emit({type:'error',message:error.message}));};
    emit({type:'ready',supported:typeof RTCPeerConnection==='function'});
    </script>
    """#
}

struct RTCTransportView: UIViewRepresentable {
    let transport: RTCTransport
    func makeUIView(context: Context) -> WKWebView { transport.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
