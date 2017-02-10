### how to deploy
```
git init
git remote add origin https://github.com/wayne-shang/parse-server.git
git checkout --orphan wx-parse-server-latest
git rm -rf .
git commit --allow-empty -m 'root commit'
git push origin wx-parse-server-latest
```
Copy the file to folder

```
git add *
git commit  -m 'Deploy 2.3.3'
git push origin wx-parse-server-latest
```