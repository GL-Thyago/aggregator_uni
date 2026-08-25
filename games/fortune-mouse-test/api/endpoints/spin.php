<?php
if ($_SERVER['REQUEST_METHOD'] != "POST") die("a");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();
if (!$user) die("User not found");



$freeMode = rand(1, 10) == 1;
$freeSpin = rand(1, 20) == 1;
$freeNum = rand(1, 8) == 1;
$freeNum = false;
define("SLOTINCONS", 0);
define("ACTIVEICONS", 1);
define("ACTIVELINES", 2);
define("DROPLINEDATA", 3);
define("MULTIPLYCOUNT", 4);
define("PAYOUT", 5);
define("FREESPIN", 6);
define("FEATURESYMBOL", 7);


function genResult()
{
    $symbols = [
        "Symbol_0",
        "Symbol_1",
        "Symbol_2",
        "Symbol_3",
        "Symbol_4",
        "Symbol_5",
        "Symbol_6",
    ];
    $result = [];
    
    $indexes = array_rand($symbols, 9);

    foreach ($indexes as $i) {
        array_push($result, $symbols[$i]);
    }

    return $result;
}

// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
$loseResults = [
    [
        ["Symbol_5", "Symbol_3", "Symbol_6", "Symbol_2", "Symbol_2", "Symbol_1", "Symbol_3", "Symbol_4", "Symbol_3"], [], [], [], 1, 0
    ]
];


// SlotIcons, ActiveIcons, ActiveLines, DropLineData, MultiplyCount, Payout
$winResults = [
    [
        [
            "Symbol_6", "Symbol_0", "Symbol_5", "Symbol_1",  "Symbol_0", "Symbol_6", "Symbol_1", "Symbol_0", "Symbol_6"
        ],
        [1, 5, 9],
        [
            [
                "index" => 4,
                "name" => "Symbol_6",
                "combine" => 3,
                "way_243" => 1,
                "payout" => 4,
                "multiply" => 0,
                "win_amount" => 0.8,
                "active_icon" => [
                    1,
                    5,
                    9
                ]
            ]
        ], [], 2, 3
    ]

];

//////////////////////////// COMMON /////////////////////////////////////////
// Just after results array declaration

shuffle($winResults);
shuffle($loseResults);

$winLength = 2;
$loseLength = 8;

$possibleResults = array_merge($winResults, $loseResults);
shuffle($possibleResults);
shuffle($symbols);

$result = genResult();

///////////////////////////////////////////////////////////////////////////

//$_POST = json_decode(file_get_contents("php://input"), true);
//$_POST['numline'] = 2;

$cpl = floatval($_POST['cpl']);
$amount = floatval($_POST['betamount']);
$numline =   floatval($_POST['numline']);
$bet = $amount * $cpl * $numline;


/////////////////////////////// COMMOM /////////////////////////////////
// Just after $bet declaration

if ($user['saldo'] + $user['bonus'] < $bet) die("Insuficient credits");
else {
    if ($user['saldo'] >= $bet) {
        $query = "UPDATE usuarios SET saldo=saldo-$bet WHERE usuario='$token'";
    } else {
        $query = "UPDATE usuarios SET saldo=0 WHERE usuario='$token'";
        $disc = $bet - $user['saldo'];
        Q("UPDATE usuarios SET bonus=$disc WHERE usuario='$token'");
    }
}

Q($query);

// To $winAmount declaration
///////////////////////////////////////////////////////////////////////

$winAmount = $cpl * $amount * 15;
$winAmount = 0;

// $result[ACTIVELINES][0]["win_amount"] = $winAmount;
Q("UPDATE usuarios SET saldo=saldo+$winAmount WHERE usuario='$token'");

$qUser = Q("SELECT * FROM usuarios WHERE usuario='$token'");
$user = $qUser->fetch_assoc();


$pull = [
    "WinAmount" => $winAmount,
    "WinOnDrop" => $winAmount,
    "TotalWay" => 27,
    "FreeSpin" => 0,
    "LastMultiply" => 0,
    "WildFixedIcons" => [],
    "HasJackpot" => false,
    "HasScatter" => false,
    "CountScatter" => 0,
    "WildColumIcon" => "",
    "MultipyScatter" => 0,
    "MultiplyCount" => 2,
    "SlotIcons" => $result,
    "ActiveIcons" => [1, 2, 3],
    "ActiveLines" => [],
    "WinLogs" => [
        "[BET] betLevel: 10, betSize:10, baseBet:20.00 => 2000",
        "[WIN] line 1: 4[Symbol_5] payout: 25 (*multipy:1) x 10 x 10 => 2500"
    ],
    "DropLine" => 3,
    "DropLineData" => [],
    "MultipleList" => [
        1,
        2,
        3,
        5
    ]
];


$data = [
    "bet" => $bet,
    "credit" => $user['saldo'] + $user['bonus'],
    "freemode" => true,
    "jackpot" => 0,
    "free_spin" => 0,
    "free_num" => $freeNum,
    "scaler" => 0,
    "num_line" =>  $_POST['numline'],
    "cpl" => $cpl,
    "betamount" => $amount,
    "bet_amount" => $bet,
    "pull" => $pull
];



S("success", true);
S("data", $data);
S("message", "Spin success");
R();
