//go:build integration

package integration

import(
 "context"
"bytes"
 "net/http"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/docker/docker/client"
 "github.com/nelcota/nelcota-deploy/internal/agent"
 agentv1 "github.com/nelcota/nelcota-deploy/internal/gen/agent/v1"
 "github.com/testcontainers/testcontainers-go"
 "github.com/testcontainers/testcontainers-go/wait"
)
// This test intentionally fails when Docker is unavailable. It never substitutes mocks for runtime integration.
func TestDockerBuildKitCaddy(t *testing.T){ctx,cancel:=context.WithTimeout(context.Background(),5*time.Minute);defer cancel();docker,e:=client.NewClientWithOpts(client.FromEnv,client.WithAPIVersionNegotiation());if e!=nil{t.Fatal(e)};defer docker.Close();if _,e=docker.Ping(ctx);e!=nil{t.Fatal("Docker required:",e)}
 config:=[]byte(`{"admin":{"listen":"0.0.0.0:2019"},"apps":{"http":{"servers":{"nelcota":{"listen":[":80"],"routes":[]}}}}}`)
 caddy,e:=testcontainers.GenericContainer(ctx,testcontainers.GenericContainerRequest{ContainerRequest:testcontainers.ContainerRequest{Image:"caddy:2.10.2",ExposedPorts:[]string{"2019/tcp"},Files:[]testcontainers.ContainerFile{{Reader:bytes.NewReader(config),ContainerFilePath:"/etc/caddy/caddy.json",FileMode:0644}},Cmd:[]string{"caddy","run","--config","/etc/caddy/caddy.json"},WaitingFor:wait.ForListeningPort("2019/tcp")},Started:true});if e!=nil{t.Fatal(e)};defer testcontainers.TerminateContainer(caddy)
 builder,e:=testcontainers.GenericContainer(ctx,testcontainers.GenericContainerRequest{ContainerRequest:testcontainers.ContainerRequest{Image:"moby/buildkit:v0.20.2",ExposedPorts:[]string{"1234/tcp"},Privileged:true,Cmd:[]string{"--addr","tcp://0.0.0.0:1234"},WaitingFor:wait.ForListeningPort("1234/tcp")},Started:true});if e!=nil{t.Fatal(e)};defer testcontainers.TerminateContainer(builder)
 proxyURL,e:=caddy.PortEndpoint(ctx,"2019/tcp","http");if e!=nil{t.Fatal(e)};buildURL,e:=builder.PortEndpoint(ctx,"1234/tcp","tcp");if e!=nil{t.Fatal(e)};engine,e:=agent.NewDockerEngine(ctx,buildURL,proxyURL,128<<20);if e!=nil{t.Fatal(e)};defer engine.Close();engine.Drain=0
 dir:=t.TempDir();if e=os.WriteFile(filepath.Join(dir,"Dockerfile"),[]byte("FROM busybox:1.37.0\nRUN mkdir -p /www && echo ok > /www/index.html\nWORKDIR /www\nUSER 65532:65532\nCMD [\"httpd\",\"-f\",\"-p\",\"8080\"]\n"),0600);e!=nil{t.Fatal(e)}
 app:=&agentv1.AppConfig{AppId:"integration",Domains:[]string{"integration.example.test"},Port:8080,MemoryBytes:64<<20,NanoCpus:1e9,Replicas:1,HealthPath:"/",HealthTimeoutSeconds:20,Dockerfile:"Dockerfile",CacheEnabled:true};dep:=&agentv1.Deploy{DeployId:"integration-build",App:app};img,e:=engine.Build(ctx,dep,dir,func([]byte){});if e!=nil{t.Fatal(e)};running,e:=engine.Start(ctx,app,img);if e!=nil{t.Fatal(e)};defer engine.Remove(context.WithoutCancel(ctx),running);for _,id:=range running.Containers{v,e:=docker.ContainerInspect(ctx,id);if e!=nil{t.Fatal(e)};if len(v.HostConfig.PortBindings)!=0||v.Config.User!="65532:65532"||!v.HostConfig.ReadonlyRootfs{t.Fatal("container is not hardened")}}
 if e=engine.Health(ctx,app,running);e!=nil{t.Fatal(e)}
 app.HealthPath="/";if e=engine.Route(ctx,app,running);e!=nil{t.Fatal(e)};req,_:=http.NewRequestWithContext(ctx,"GET",proxyURL+"/config/apps/http/servers/nelcota/routes",nil);resp,e:=http.DefaultClient.Do(req);if e!=nil{t.Fatal(e)};resp.Body.Close();if resp.StatusCode!=200{t.Fatal(resp.StatusCode)}
}
