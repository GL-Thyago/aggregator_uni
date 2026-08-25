<?php
if ($_SERVER["REQUEST_METHOD"] != "POST") {
    die("a");
}

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();
if (!$user) {
    die("User not found");
}

$freeMode = rand(1, 10) == 1;
$freeSpin = rand(1, 20) == 1;
$freeNum = rand(1, 5) == 1;
$freeNum = false;

define("SLOTINCONS", 0);
define("ACTIVEICONS", 1);
define("ACTIVELINES", 2);
define("DROPLINEDATA", 3);
define("MULTIPLYCOUNT", 4);
define("PAYOUT", 5);
define("FREESPIN", 6);
define("FEATURESYMBOL", 7);

// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
 

$demoWinResults = [];
// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
 

$winResults = [
     [
        [
                 "Symbol_3",
                "Symbol_0",
                "Symbol_1",
                "Symbol_1",
                "Symbol_5",
                "Symbol_4",
                "Symbol_4",
                "Symbol_4",
                "Symbol_1",
                "_blank",
                "Symbol_4",
                "_blank"
        ],
        [ 7, 8, 6],
        [
            [
                "index" => 8,
                "name" => "Symbol_4",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 10,
                "multiply" => 0,
                "win_amount" => 2,
                "active_icon" => [ 7,
                8,
                6],
            ],
        ],
        [],
        0,
        10,
    ],
    [
        [
               "Symbol_3",
                "Symbol_0",
                "Symbol_3",
                "Symbol_6",
                "Symbol_2",
                "Symbol_6",
                "Symbol_5",
                "Symbol_4",
                "Symbol_1",
                "_blank",
                "Symbol_0",
                "_blank"
        ],
        [1,2,3],
        [
            [
                "index" => 1,
                "name" => "Symbol_4",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 20,
                "multiply" => 0,
                "win_amount" => 2,
                "active_icon" => [1,2,3],
            ],
        ],
        [],
        0,
        20,
    ],
        [
        [
              "Symbol_2",
                "Symbol_6",
                "Symbol_3",
                "Symbol_1",
                "Symbol_0",
                "Symbol_4",
                "Symbol_4",
                "Symbol_1",
                "Symbol_1",
                "_blank",
                "Symbol_1",
                "_blank"
        ],
        [ 4, 8,  9],
        [
            [
                "index" => 7,
                "name" => "Symbol_4",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 10,
                "multiply" => 0,
                "win_amount" => 2,
                "active_icon" => [ 4, 8, 9],
            ],
        ],
        [],
        0,
        50,
    ]
];

//////////////////////////// COMMON /////////////////////////////////////////
// Just after results array declaration

$loseResults = [
    [
        [ "Symbol_5",
            "Symbol_4",
            "Symbol_4",
            "Symbol_1",
            "Symbol_1",
            "Symbol_6",
            "Symbol_3",
            "Symbol_2",
            "Symbol_2",
            "Symbol_5",
            "Symbol_3",
            "Symbol_6",], [], [], [], 1, 0
    ]
  
];

$loseResults = array_fill(0, 10, $loseResults[0]);
shuffle($winResults);
shuffle($loseResults);


$winLength = 1;
$loseLength = 9;


$winResults = array_slice($winResults, 0, $winLength);
$loseResults = array_slice($loseResults, 0, $loseLength);

$possibleResults = array_merge($winResults, $loseResults);
shuffle($possibleResults);
$result = $possibleResults[0];

///////////////////////////////////////////////////////////////////////////

$cpl = intval($_POST["cpl"]);
$amount = floatval($_POST["betamount"]);
$numline = intval($_POST["numline"]);
$bet = $amount * $cpl * $numline;

/////////////////////////////// COMMOM /////////////////////////////////
// Just after $bet declaration

if ($user["saldo"] + $user["bonus"] < $bet) {
    die("Insuficient credits");
} else {
    if ($user["saldo"] >= $bet) {
        Q("UPDATE usuarios SET saldo=saldo-$bet WHERE usuario='$token'");
    } else {
        $disc = $bet - $user["saldo"];
        Q("UPDATE usuarios SET saldo=0 WHERE usuario='$token'");
        Q("UPDATE usuarios SET bonus=bonus-$disc WHERE usuario='$token'");
    }
}

// Q($query);

// To $winAmount declaration
///////////////////////////////////////////////////////////////////////
 
$winAmount = $cpl * $amount * $result[PAYOUT];


if($winAmount <= 0) {
    shuffle($result[0]);
    $result[0][11] = "_blank";
    $result[0][9] = "_blank";
}


$result[ACTIVELINES][0]["win_amount"] = $winAmount;
Q("UPDATE usuarios SET saldo=saldo+$winAmount WHERE usuario='$token'");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();

$pull = [
    "WinAmount" => $winAmount,
    "WinOnDrop" => $winAmount,
    "TotalWay" => 27,
    "FreeSpin" => 0, // $result[FREESPIN] * (-1),
    "LastMultiply" => 0,
    "WildFixedIcons" => [],
    "HasJackpot" => false,
    "HasScatter" => false,
    "CountScatter" => 0,
    "WildColumIcon" => "",
    "MultipyScatter" => 0,
    "MultiplyCount" => 2,
    "SlotIcons" => $result[0],
    "ActiveIcons" => $result[1],
    "ActiveLines" => $result[2],
    "WinLogs" => [
        "[BET] betLevel: 10, betSize:10, baseBet:20.00 => 2000",
        "[WIN] line 1: 4[Symbol_5] payout: 25 (*multipy:1) x 10 x 10 => 2500",
    ],
    "DropLine" => 3,
    "DropLineData" => $result[3],
    "MultipleList" => [1, 2, 3, 5],
];

$data = [
    "credit" => $user["saldo"] + $user["bonus"],
    "freemode" => true,
    "jackpot" => 0,
    "free_spin" => 0,
    "free_num" => $freeNum,
    "scaler" => 0,
    "num_line" => $_POST["numline"],
    "cpl" => $cpl,
    "betamount" => $amount,
    "bet_amount" => $bet,
    "pull" => $pull,
];

S("success", true);
S("data", $data);
S("message", "Spin success");
R();
