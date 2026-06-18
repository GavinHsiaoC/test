param(
    [string]$Host = "127.0.0.1",
    [int]$Port = 8000
)

conda run -n test1 python app.py --host $Host --port $Port
