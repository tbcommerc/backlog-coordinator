data = open("test_import_200.csv", "rb").read(500)
first_line = data.split(b"\n", 1)[0]
print("First 10 bytes (hex):", data[:10].hex())
print("Decoded utf-8-sig:", first_line.decode("utf-8-sig"))
print()
headers = first_line.decode("utf-8-sig").split(";")
for i, h in enumerate(headers):
    print(f"  [{i}] repr={repr(h)} hex={h.encode('utf-8').hex()}")
