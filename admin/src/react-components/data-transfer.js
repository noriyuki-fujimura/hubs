import React, { Component } from "react";
import { withStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import Card from "@material-ui/core/Card";
import CardContent from "@material-ui/core/CardContent";
import Checkbox from "@material-ui/core/Checkbox";
import CircularProgress from "@material-ui/core/CircularProgress";
import LinearProgress from "@material-ui/core/LinearProgress";
import FormControlLabel from "@material-ui/core/FormControlLabel";
import { Title } from "react-admin";
import Button from "@material-ui/core/Button";
import withCommonStyles from "../utils/with-common-styles";
import { getAdminInfo, getConfig, putConfig } from "../utils/ita";
import Snackbar from "@material-ui/core/Snackbar";
import SnackbarContent from "@material-ui/core/SnackbarContent";
import Icon from "@material-ui/core/Icon";
import IconButton from "@material-ui/core/IconButton";
import CloseIcon from "@material-ui/icons/Close";
import clsx from "classnames";

// NOTE there's a mysterious uncaught exception in a promise when this component is shown, that seems
// to be coupled with the "All 3rd party content" typography block. It's a mystery.

const styles = withCommonStyles(() => ({
  worker: {
    width: "600px",
    height: "200px",
    fontFamily: "monospace",
    marginTop: "8px"
  }
}));

const workerScript = (workerDomain, assetsDomain) => {
  return `  const ALLOWED_ORIGINS = ["${document.location.origin}"];
  const PROXY_HOST = "https://${workerDomain}";
  const STORAGE_HOST = "${document.location.origin}";
  const ASSETS_HOST = "https://${assetsDomain}";
  
  let cache = caches.default;
  
  addEventListener("fetch", e => {
    const request = e.request;
    const origin = request.headers.get("Origin");
    const proxyUrl = new URL(PROXY_HOST);
    // eslint-disable-next-line no-useless-escape
    const targetPath = request.url.substring(PROXY_HOST.length + 1);
    let useCache = false;
    let targetUrl;
  
    if (targetPath.indexOf("files/") === 0) {
      useCache = true;
      targetUrl = \`\${STORAGE_HOST}/\${targetPath}\`;
    } else if (targetPath.indexOf("hubs/") === 0 || targetPath.indexOf("spoke/") === 0 || targetPath.indexOf("admin/") === 0) {
      useCache = true;
      targetUrl = \`\${ASSETS_HOST}/\${targetPath}\`;
    } else {
      targetUrl = request.url.substring(PROXY_HOST.length + 1).replace(/^http(s?):\/([^/])/, "http$1://$2");
  
      if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        targetUrl = proxyUrl.protocol + "//" + targetUrl;
      }
    }
    
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("Origin"); // Some domains disallow access from improper Origins
  
    e.respondWith((async () => {
      let cacheReq;
  
      if (useCache) {
        cacheReq = new Request(targetUrl, { headers: requestHeaders, method: request.method, redirect: "manual" });
        const res = await cache.match(cacheReq, {});
        if (res) return res;
      }
  
      const res = await fetch(targetUrl, { headers: requestHeaders, method: request.method, redirect: "manual", referrer: request.referrer, referrerPolicy: request.referrerPolicy });      
      const responseHeaders = new Headers(res.headers);
      const redirectLocation = responseHeaders.get("Location") || responseHeaders.get("location");
  
      if(redirectLocation) {
        if (!redirectLocation.startsWith("/")) {
          responseHeaders.set("Location",  proxyUrl.protocol + "//" + proxyUrl.host + "/" + redirectLocation);
        } else {
          const tUrl = new URL(targetUrl);
          responseHeaders.set("Location",  proxyUrl.protocol + "//" + proxyUrl.host + "/" + tUrl.origin + redirectLocation);
        }
      }
  
      if (origin && ALLOWED_ORIGINS.indexOf(origin) >= 0) {
        responseHeaders.set("Access-Control-Allow-Origin", origin);
        responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        responseHeaders.set("Access-Control-Allow-Headers", "Range");
        responseHeaders.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Encoding, Content-Length, Content-Range");
      }
  
      responseHeaders.set("Vary", "Origin");
      responseHeaders.set('X-Content-Type-Options', "nosniff");
      let body = res.body;
  
      if (useCache) {
        const [body1, body2] = res.body.tee();
        body = body2;
        await cache.put(cacheReq, new Response(body1, { status: res.status, statusText: res.statusText, headers: responseHeaders }));
      }
  
      return new Response(body, { status: res.status, statusText: res.statusText, headers: responseHeaders });  
    })());
  });`;
};

class DataTransferComponent extends Component {
  state = {
    workerDomain: "",
    assetsDomain: "",
    enableWorker: false,
    saving: false,
    saveError: false,
    loading: false
  };

  async componentDidMount() {
    const adminInfo = await getAdminInfo();
    const retConfig = await getConfig("reticulum");

    this.setState({
      workerDomain: adminInfo.worker_domain,
      assetsDomain: adminInfo.assets_domain,
      enableWorker: !!retConfig && !!retConfig.phx && retConfig.phx.cors_proxy_url_host === adminInfo.workerDomain,
      loading: false
    });
  }

  onSubmit(e) {
    e.preventDefault();

    this.setState({ saving: true }, async () => {
      const workerDomain = this.state.enableWorker ? this.state.workerDomain : "";

      const configs = {
        reticulum: {
          phx: {
            cors_proxy_url_host: workerDomain
          },
          uploads: {
            host: workerDomain ? `https://${workerDomain}` : ""
          }
        },
        hubs: {
          general: {
            cors_proxy_server: workerDomain,
            base_assets_path: workerDomain ? `https://${workerDomain}/hubs/` : ""
          }
        },
        spoke: {
          general: {
            cors_proxy_server: workerDomain,
            base_assets_path: workerDomain ? `https://${workerDomain}/spoke/` : ""
          }
        }
      };

      try {
        for (const [service, config] of Object.entries(configs)) {
          const res = await putConfig(service, config);

          if (res.error) {
            this.setState({ saveError: `Error saving: ${res.error}` });
            break;
          }
        }
      } catch (e) {
        this.setState({ saveError: e.toString() });
      }

      this.setState({ saving: false, saved: true });
    });
  }

  render() {
    if (this.state.loading) {
      return <LinearProgress />;
    }

    return (
      <Card className={this.props.classes.container}>
        <Title title="Data Transfer" />
        <form onSubmit={this.onSubmit.bind(this)}>
          <CardContent className={this.props.classes.info}>
            <Typography variant="body2" gutterBottom>
              Hubs Cloud uses bandwidth from your cloud provider to deliver content.
              <br />
              You can potentially reduce your data transfer costs by switching the CDN for CORS proxying, assets, and
              stored files to Cloudflare, which does not charge for data transfer costs to your users.
            </Typography>
            <Typography variant="subheading" gutterBottom className={this.props.classes.section}>
              Worker Setup
            </Typography>
            <Typography variant="body1" gutterBottom>
              All 3rd party content (videos, images, models) in Hubs Cloud requires CORS proxying due to the{" "}
              <a href="https://www.codecademy.com/articles/what-is-cors" rel="noopener noreferrer" target="_blank">
                browser security model
              </a>
              . As such, you will be using data transfer to send all 3rd party content to your users.
            </Typography>
            <Typography variant="body1" gutterBottom>
              Additionally, you will incur data transfer costs for serving avatars, scenes, and other assets.
            </Typography>
            <Typography variant="body1" gutterBottom>
              You can minimize this data transfer cost by using a Cloudflare Worker to serve this content:
            </Typography>
            <Typography variant="body1" component="div" gutterBottom>
              <ol className={this.props.classes.steps}>
                <li>
                  Register and set up this domain name on{" "}
                  <a href="https://cloudflare.com" target="_blank" rel="noopener noreferrer">
                    Cloudflare
                  </a>
                  :<div className={this.props.classes.command}>{this.state.workerDomain}</div>
                </li>
                <li>
                  In the &apos;DNS&apos; section of your Cloudflare domain settings, add new CNAME record with Name set
                  to <pre>@</pre> and Domain Name set to:
                  <div className={this.props.classes.command}>{document.location.hostname}</div>
                </li>
                <li>
                  In the Workers section of your Cloudflare domain, launch the editor, click &quot;Add Script&quot; on
                  the left and name it &apos;hubs-worker&apos; Then, paste and save the following worker script.
                  <br />
                  <textarea
                    className={this.props.classes.worker}
                    value={workerScript(this.state.workerDomain, this.state.assetsDomain)}
                    readOnly
                    onFocus={e => e.target.select()}
                  />
                  <br />
                </li>
                <li>
                  Once your script is saved, go back to the Workers panel. Choose &apos;Add Route&apos;, choose your{" "}
                  <pre>hubs-worker</pre> script and set the route to:
                  <div className={this.props.classes.command}>{`${this.state.workerDomain}/*`}</div>
                </li>
                <li>
                  Verify your worker is working.{" "}
                  <a
                    href={`https://${this.state.workerDomain}/https://www.mozilla.org`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    This link
                  </a>{" "}
                  should show the Mozilla homepage.
                </li>
                <li>
                  Once working, enable the &apos;Use Cloudflare Worker&apos; setting below and click &apos;Save&apos; on
                  this page.
                </li>
              </ol>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={this.state.enableWorker}
                    onChange={e => this.setState({ enableWorker: e.target.checked })}
                    value="enableWorker"
                  />
                }
                label="Use Cloudflare Worker"
              />
            </Typography>
            {this.state.saving ? (
              <CircularProgress />
            ) : (
              <Button
                onClick={this.onSubmit.bind(this)}
                className={this.props.classes.button}
                variant="contained"
                color="primary"
              >
                Save
              </Button>
            )}
          </CardContent>
        </form>
        <Snackbar
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          open={this.state.saved || !!this.state.saveError}
          autoHideDuration={10000}
          onClose={() => this.setState({ saved: false, saveError: null })}
        >
          <SnackbarContent
            className={clsx({
              [this.props.classes.success]: !this.state.saveError,
              [this.props.classes.warning]: !!this.state.saveError
            })}
            message={
              <span id="import-snackbar" className={this.props.classes.message}>
                <Icon className={clsx(this.props.classes.icon, this.props.classes.iconVariant)} />
                {this.state.saveError || "Settings saved."}
              </span>
            }
            action={[
              <IconButton key="close" color="inherit" onClick={() => this.setState({ saved: false })}>
                <CloseIcon className={this.props.classes.icon} />
              </IconButton>
            ]}
          />
        </Snackbar>
      </Card>
    );
  }
}

export const DataTransfer = withStyles(styles)(DataTransferComponent);
