<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>AZTec Slotgen</title>
    <!-- Latest compiled and minified CSS -->
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css">
    <!-- jQuery library -->
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.3/jquery.min.js"></script>
    <!-- Latest compiled JavaScript -->
    <script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/js/bootstrap.min.js"></script>
</head>

<body>
    <div class="container">
        <img src="images/fortune-tiger.png" class="thumb" alt="Responsive image">
        <h1>Fortune Tiger</h1>        
        <a href="#" class="btn btn-default" id="btnPlayGame" target="_blank">Play Game</a>
        <script>
            const rootDomain = window.location.hostname;
            console.log('rootDomain', rootDomain);
            $(document).ready(function() {
                const domainCompare = 'localhost'; //simplephp.slotgen.com
                const portStr = domainCompare == 'localhost' ? ':8000' : '';
                const schemaStr = domainCompare == 'localhost' ? 'http://' : 'https://';
                const gameId = 'fortune_tiger';
                const rootUrl = (rootDomain == domainCompare && domainCompare != 'localhost') ? rootDomain + '/' + gameId : rootDomain + portStr;
                console.log('rootUrl', rootUrl);
                const apiUrl = schemaStr + rootUrl + '/api.php';
                var postData = {
                    player: "demo1",
                    credit: 5000,
                    action: "launch",
                    game: gameId
                };
                $.ajax({
                    type: 'POST',
                    url: apiUrl,
                    data: JSON.stringify(postData),
                    contentType: "application/json",
                    dataType: 'json',
                    success: function(data) {
                        const resData = data.data;
                        const sessionId = resData.session_id;
                        console.log(sessionId);
                        $("#btnPlayGame").attr("href", schemaStr + rootUrl + "/games/" + gameId + "/index.html?token=" + sessionId);

                    },
                })




            });
        </script>

        <style>
            img.thumb {
                width: 60%;
            }
        </style>
</body>

</html>